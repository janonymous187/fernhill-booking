/*
 * Fernhill Mobile Grooming: booking server with Stripe Checkout.
 *
 * Env (set on the server only, never in the browser or git):
 *   STRIPE_SECRET_KEY      test (rk_test_/sk_test_) or live (rk_live_/sk_live_). Empty starts with payments off.
 *   STRIPE_WEBHOOK_SECRET  whsec_… for /api/webhook
 *   DASHBOARD_PASSWORD     password for the groomer bookings page. If unset, that page stays closed.
 *   DATA_DIR               optional directory for db.json (defaults to server/data)
 *   PUBLIC_URL             public https origin, used for Checkout success/cancel URLs
 *   PORT                   default 8787
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Stripe = require('stripe');
const catalog = require('./catalog');
const auth = require('./auth');
const { stripeModeFromKey, redact } = require('./stripe-mode');
const { metadataFromBooking, bookingFromSession, recoverBookings, isPaidSession } = require('./booking-record');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env file */ }

const PORT = process.env.PORT ? +process.env.PORT : 8787;
const KEY = process.env.STRIPE_SECRET_KEY || '';
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripeMode = stripeModeFromKey(KEY);
if (stripeMode === 'invalid') {
  console.error('Refusing to start: STRIPE_SECRET_KEY must be a test key (sk_test_ or rk_test_) or a live key (sk_live_ or rk_live_).');
  process.exit(1);
}
// One Stripe client for the whole server (no global API key).
// STRIPE_API_BASE is for local testing against stripe-mock only.
const mockBase = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
const stripe = KEY ? new Stripe(KEY, { appInfo: { name: 'fernhill-booking-demo' }, ...(mockBase ? { host: mockBase.hostname, port: mockBase.port, protocol: mockBase.protocol.replace(':', '') } : {}) }) : null;
const INTEGRATION_ID = 'fernhill_deposit_' + (process.env.INTEGRATION_SUFFIX || 'qhvmzrta');

/* ---------- tiny JSON store ---------- */
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DATA = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function freshDb() {
  return { config: catalog.defaults(), bookings: [], pending: {} };
}
function loadDb() {
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return freshDb();
  if (!parsed.config || !Array.isArray(parsed.config.services)) parsed.config = catalog.defaults();
  if (!Array.isArray(parsed.bookings)) parsed.bookings = [];
  if (!parsed.pending || typeof parsed.pending !== 'object' || Array.isArray(parsed.pending)) parsed.pending = {};
  return parsed;
}
let db = loadDb();
const persist = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA + '.tmp', JSON.stringify(db, null, 1));
  fs.renameSync(DATA + '.tmp', DATA);
};
persist();

const makeRef = () => 'FH-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4).replace(/[01OIL]/g, 'X') + crypto.randomInt(10);
const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);

function paymentsInfo() {
  return { provider: 'stripe', mode: stripeMode, configured: !!stripe, webhook: !!WHSEC };
}

/* ---------- rebuild paid bookings from Stripe after a restart ---------- */
let recoverPromise = null;
let recoveredAt = 0;
const RECOVER_MS = 30 * 1000;
let statusWarned = false;

async function listPaidSessions() {
  const expandTries = [['data.payment_intent.latest_charge'], ['data.payment_intent'], []];
  let lastErr;
  for (const expand of expandTries) {
    try {
      const all = [];
      let startingAfter;
      for (let page = 0; page < 20; page++) {
        const params = { limit: 100, status: 'complete' };
        if (startingAfter) params.starting_after = startingAfter;
        if (expand.length) params.expand = expand;
        const res = await stripe.checkout.sessions.list(params);
        all.push(...res.data);
        if (!res.has_more || !res.data.length) break;
        startingAfter = res.data[res.data.length - 1].id;
      }
      return all;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function recoverFromStripe() {
  if (!stripe) return;
  const sessions = await listPaidSessions();
  const next = recoverBookings(db.bookings, sessions, db.config);
  let pendingChanged = false;
  for (const b of next) {
    if (b.ref && db.pending[b.ref]) { delete db.pending[b.ref]; pendingChanged = true; }
  }
  const changed = pendingChanged || JSON.stringify(next) !== JSON.stringify(db.bookings);
  db.bookings = next;
  if (changed) {
    persist();
    console.log(`[recover] stored ${db.bookings.length} booking(s)`);
  }
}

function ensureRecovered(maxMs = 8000) {
  if (!stripe) return Promise.resolve();
  if (Date.now() - recoveredAt < RECOVER_MS) return Promise.resolve();
  if (!recoverPromise) {
    recoverPromise = recoverFromStripe()
      .catch(e => { console.error('[recover]', redact(e && e.message)); })
      .finally(() => { recoveredAt = Date.now(); recoverPromise = null; });
  }
  const job = recoverPromise;
  if (!maxMs) return job;
  return Promise.race([job, new Promise(resolve => setTimeout(resolve, maxMs))]);
}

async function rememberStatus(b) {
  if (!stripe || !b || !b.payment || !b.status) return;
  const metadata = { booking_status: String(b.status).slice(0, 40), booking_seen: b.seen ? '1' : '0' };
  const tasks = [];
  if (b.payment.sessionId) tasks.push(stripe.checkout.sessions.update(b.payment.sessionId, { metadata }));
  if (b.payment.id && String(b.payment.id).startsWith('pi_')) tasks.push(stripe.paymentIntents.update(b.payment.id, { metadata }));
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected' && !statusWarned) {
      statusWarned = true;
      console.warn('[status] could not save booking status to Stripe:', redact(r.reason && r.reason.message));
    }
  }
}

/* ---------- fulfillment (idempotent; webhook is primary, return page is a backup) ---------- */
async function fulfill(sessionId, source) {
  const existing = db.bookings.find(b => b.payment && b.payment.sessionId === sessionId);
  if (existing) return existing;
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] });
  if (session.payment_status === 'unpaid' || !isPaidSession(session)) return null;
  const ref = (session.metadata && session.metadata.booking_ref) || session.client_reference_id;
  const pending = ref && db.pending[ref];
  if (pending && session.amount_total != null && session.amount_total !== Math.round(Number(pending.deposit) * 100)) {
    throw new Error('Amount mismatch for ' + ref);
  }
  const rebuilt = bookingFromSession(session, db.config);
  if (!pending && !rebuilt) throw new Error('No booking data for ' + (ref || sessionId));
  const again = db.bookings.find(b => b.ref === (pending ? pending.ref : rebuilt.ref));
  if (again) return again;
  const b = pending
    ? { ...pending, seen: false, status: 'confirmed', payment: rebuilt ? rebuilt.payment : {
        id: typeof session.payment_intent === 'string' ? session.payment_intent : '',
        sessionId, status: 'succeeded', method: 'Card',
        provider: session.livemode ? 'stripe' : 'stripe-test', livemode: !!session.livemode, paidAt: new Date().toISOString()
      } }
    : rebuilt;
  db.bookings.push(b);
  if (b.ref && db.pending[b.ref]) delete db.pending[b.ref];
  persist();
  console.log(`[fulfill] ${b.ref} confirmed via ${source} (${session.id}, $${b.deposit} ${session.livemode ? 'live' : 'test'} deposit)`);
  return b;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

function requireDashboard(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!auth.passwordConfigured()) return res.status(403).json({ error: 'The dashboard is not available.' });
  if (!auth.sessionValid(auth.readCookie(req, auth.COOKIE))) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

/* Webhook needs the raw body for signature verification, so it is registered before express.json(). */
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !WHSEC) return res.status(503).send('Webhook not configured');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WHSEC); }
  catch (e) { console.warn('[webhook] bad signature:', redact(e.message)); return res.status(400).send('Bad signature'); }
  try {
    const s = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (s.payment_status !== 'unpaid') await fulfill(s.id, 'webhook:' + event.type);
        break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const ref = s.metadata && s.metadata.booking_ref;
        if (ref && db.pending[ref]) { delete db.pending[ref]; persist(); console.log(`[webhook] ${event.type} → released ${ref}`); }
        break;
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[webhook] error:', redact(e.message));
    res.status(500).send('Handler error');
  }
});

app.use(express.json({ limit: '200kb' }));

app.get('/api/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const available = auth.passwordConfigured();
  const signedIn = available && auth.sessionValid(auth.readCookie(req, auth.COOKIE));
  res.json({ available, signedIn });
});

app.post('/api/login', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!auth.passwordsMatch(password)) return res.status(401).json({ error: "That password isn't right." });
  res.cookie(auth.COOKIE, auth.sessionToken(), auth.cookieOptions(req));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const opts = auth.cookieOptions(req);
  res.clearCookie(auth.COOKIE, { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path });
  res.json({ ok: true });
});

app.get('/api/catalog', async (req, res) => {
  await ensureRecovered(4000);
  const busy = db.bookings.filter(b => b.status !== 'cancelled').map(b => ({ start: b.start, minutes: b.minutes }));
  res.json({ config: db.config, payments: paymentsInfo(), busy });
});

app.get('/api/state', requireDashboard, async (req, res) => {
  await ensureRecovered();
  res.json({ config: db.config, bookings: db.bookings, payments: paymentsInfo() });
});

app.put('/api/config', requireDashboard, (req, res) => {
  const c = catalog.sanitizeConfig(req.body);
  if (!c) return res.status(400).json({ error: 'Invalid settings' });
  db.config = c; persist(); res.json({ ok: true, config: c });
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe test mode is not connected on the server yet.' });
  await ensureRecovered();
  const { serviceId, size, addons, start, form = {}, expectedDeposit } = req.body || {};
  const q = catalog.quote(db.config, { serviceId, size, addons });
  if (!q) return res.status(400).json({ error: 'That service is no longer available.' });
  if (typeof expectedDeposit === 'number' && expectedDeposit !== q.deposit) return res.status(409).json({ error: 'Prices were just updated. Please review your booking again.', code: 'price_changed' });
  const st = new Date(start).getTime();
  if (!Number.isFinite(st) || st < Date.now()) return res.status(400).json({ error: 'Please pick a time in the future.' });
  const buf = db.config.settings.travelBufferMin * 60e3, en = st + q.minutes * 60e3 + buf;
  const clash = db.bookings.some(b => b.status === 'confirmed' && (() => { const a = new Date(b.start).getTime(); return st < a + b.minutes * 60e3 + buf && a < en; })());
  if (clash) return res.status(409).json({ error: 'Sorry, that time was just taken. Please pick another.', code: 'slot_taken' });
  const email = clean(form.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !clean(form.dogName) || !clean(form.name)) return res.status(400).json({ error: 'Please complete your details.' });

  const ref = makeRef();
  const booking = {
    id: 'b' + Date.now() + crypto.randomInt(1000), ref, createdAt: new Date().toISOString(), source: 'online',
    serviceId: q.svc.id, serviceName: q.svc.name, size, addons: q.addons.map(a => ({ ...a })), minutes: q.minutes,
    start: new Date(st).toISOString(), total: q.total, deposit: q.deposit, balance: q.balance,
    dog: { name: clean(form.dogName, 60), breed: clean(form.breed, 60), age: clean(form.age, 30), notes: clean(form.dogNotes, 500) },
    customer: { name: clean(form.name, 80), phone: clean(form.phone, 30), email },
    address: { street: clean(form.street, 120), unit: clean(form.unit, 30), city: clean(form.city, 60), zip: clean(form.zip, 10), access: clean(form.access, 300) }
  };
  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const when = new Date(st).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const meta = metadataFromBooking({ ...booking, status: 'confirmed' });
  const testNote = stripeMode === 'live' ? '' : ' TEST MODE, no real charge.';
  const params = {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(q.deposit * 100), product_data: {
      name: `Deposit: ${q.svc.name} for ${booking.dog.name}`,
      description: `${when} (Central). Total $${q.total}; $${q.balance} balance due at the visit.${testNote}`
    } } }],
    customer_email: email,
    client_reference_id: ref,
    metadata: meta,
    payment_intent_data: { description: `Fernhill deposit ${ref} (${q.svc.name}, ${booking.dog.name})`, metadata: { ...meta } },
    success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#/return`,
    cancel_url: `${origin}/#/review`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    integration_identifier: INTEGRATION_ID
  };
  try {
    let session;
    try { session = await stripe.checkout.sessions.create(params); }
    catch (e) {
      if (e && e.param === 'integration_identifier') { delete params.integration_identifier; session = await stripe.checkout.sessions.create(params); }
      else throw e;
    }
    db.pending[ref] = booking; persist();
    console.log(`[checkout] ${ref} session ${session.id} for $${q.deposit} (${stripeMode})`);
    res.json({ url: session.url, ref });
  } catch (e) {
    console.error('[checkout] error:', redact(e.message));
    const msg = stripeMode === 'live' ? 'Could not start checkout. Please try again.' : 'Could not start Stripe test checkout. Please try again.';
    res.status(502).json({ error: msg });
  }
});

// Return page: confirm the session and fulfill idempotently (the webhook is the primary path).
app.get('/api/checkout/status', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const id = String(req.query.session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'Bad session id' });
  try {
    const b = await fulfill(id, 'return-page');
    if (b) return res.json({ status: 'paid', booking: b });
    res.json({ status: 'unpaid' });
  } catch (e) { console.error('[status] error:', redact(e.message)); res.status(500).json({ error: 'Could not confirm payment yet.' }); }
});

app.patch('/api/bookings/:id', requireDashboard, async (req, res) => {
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (typeof req.body.seen === 'boolean') b.seen = req.body.seen;
  let statusChanged = false;
  if (['completed', 'noshow'].includes(req.body.status) && b.status === 'confirmed') {
    b.status = req.body.status;
    statusChanged = true;
  }
  persist();
  if (statusChanged) await rememberStatus(b);
  res.json({ booking: b });
});

app.post('/api/bookings/:id/refund', requireDashboard, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status === 'cancelled') return res.json({ booking: b });
  try {
    const r = await stripe.refunds.create({ payment_intent: b.payment.id, metadata: { booking_ref: b.ref } });
    b.status = 'cancelled'; b.payment = { ...b.payment, refundId: r.id, status: 'refunded' };
    persist();
    await rememberStatus(b);
    res.json({ booking: b });
  } catch (e) { console.error('[refund] error:', redact(e.message)); res.status(502).json({ error: 'Refund failed: ' + redact(e.message) }); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, stripe: stripeMode, webhook: !!WHSEC }));

// Static app (only the public files, never server/).
const ROOT = path.join(__dirname, '..');
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Fernhill booking server on :${PORT} (Stripe ${stripeMode}, webhook ${WHSEC ? 'on' : 'off'}, dashboard ${auth.passwordConfigured() ? 'locked' : 'closed'})`);
    ensureRecovered(0);
  });
}

module.exports = { app };
