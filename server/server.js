/*
 * Fernhill Mobile Grooming: booking server with Stripe Checkout (TEST MODE ONLY).
 *
 * Env (set on the server only, never in the browser or git):
 *   STRIPE_SECRET_KEY      restricted test key (rk_test_…) preferred; sk_test_… also accepted. Live keys are refused.
 *   STRIPE_WEBHOOK_SECRET  whsec_… for the /api/webhook endpoint (from `npm run setup-webhook` or the Dashboard)
 *   PUBLIC_URL             public https origin, used for Checkout success/cancel URLs (falls back to the request host)
 *   PORT                   default 8787
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Stripe = require('stripe');
const catalog = require('./catalog');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env file */ }

const PORT = +process.env.PORT || 8787;
const KEY = process.env.STRIPE_SECRET_KEY || '';
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
if (KEY && !/^(rk|sk)_test_/.test(KEY)) {
  console.error('Refusing to start: STRIPE_SECRET_KEY is not a TEST-mode key. This app only runs in Stripe test mode.');
  process.exit(1);
}
// One StripeClient instance for the whole server (no global API key).
// STRIPE_API_BASE is for local testing against stripe-mock only (e.g. http://localhost:12111).
const mockBase = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
const stripe = KEY ? new Stripe(KEY, { appInfo: { name: 'fernhill-booking-demo' }, ...(mockBase ? { host: mockBase.hostname, port: mockBase.port, protocol: mockBase.protocol.replace(':', '') } : {}) }) : null;
const INTEGRATION_ID = 'fernhill_deposit_' + (process.env.INTEGRATION_SUFFIX || 'qhvmzrta');

/* ---------- tiny JSON store ---------- */
const DATA = path.join(__dirname, 'data', 'db.json');
fs.mkdirSync(path.dirname(DATA), { recursive: true });
let db;
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { db = null; }
if (!db) db = { config: catalog.defaults(), bookings: [], pending: {} };
const persist = () => { fs.writeFileSync(DATA + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DATA + '.tmp', DATA); };
persist();

const makeRef = () => 'FH-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4).replace(/[01OIL]/g, 'X') + crypto.randomInt(10);
const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);

/* ---------- fulfillment (idempotent; called by webhook and by the return page) ---------- */
async function fulfill(sessionId, source) {
  const existing = db.bookings.find(b => b.payment && b.payment.sessionId === sessionId);
  if (existing) return existing;
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] });
  if (session.livemode) throw new Error('Live-mode session refused');
  if (session.payment_status === 'unpaid') return null; // not paid (yet)
  const ref = session.metadata && session.metadata.booking_ref;
  const p = ref && db.pending[ref];
  if (!p) throw new Error('No pending booking for ' + ref);
  if (session.amount_total !== Math.round(p.deposit * 100)) throw new Error('Amount mismatch for ' + ref);
  const again = db.bookings.find(b => b.ref === ref);
  if (again) return again;
  const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const card = pi && pi.latest_charge && pi.latest_charge.payment_method_details && pi.latest_charge.payment_method_details.card;
  const method = card ? `${card.brand[0].toUpperCase() + card.brand.slice(1)} •••• ${card.last4}` : 'Card';
  const b = {
    ...p, seen: false, status: 'confirmed',
    payment: { id: pi ? pi.id : session.payment_intent, sessionId, status: 'succeeded', method, provider: 'stripe-test', livemode: false, paidAt: new Date().toISOString() }
  };
  db.bookings.push(b);
  delete db.pending[ref];
  persist();
  console.log(`[fulfill] ${ref} confirmed via ${source} (${session.id}, $${p.deposit} test deposit)`);
  return b;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

/* Webhook needs the raw body for signature verification, so it is registered before express.json(). */
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !WHSEC) return res.status(503).send('Webhook not configured');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WHSEC); }
  catch (e) { console.warn('[webhook] bad signature:', e.message); return res.status(400).send('Bad signature'); }
  if (event.livemode) return res.status(400).send('Live events refused');
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
    console.error('[webhook] error:', e.message);
    res.status(500).send('Handler error');
  }
});

app.use(express.json({ limit: '200kb' }));

app.get('/api/state', (req, res) => {
  res.json({ config: db.config, bookings: db.bookings, payments: { provider: 'stripe', mode: 'test', configured: !!stripe, webhook: !!WHSEC } });
});

app.put('/api/config', (req, res) => {
  const c = catalog.sanitizeConfig(req.body);
  if (!c) return res.status(400).json({ error: 'Invalid settings' });
  db.config = c; persist(); res.json({ ok: true, config: c });
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe test mode is not connected on the server yet.' });
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
  const params = {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(q.deposit * 100), product_data: {
      name: `Deposit: ${q.svc.name} for ${booking.dog.name}`,
      description: `${when} (Central). Total $${q.total}; $${q.balance} balance due at the visit. TEST MODE, no real charge.`
    } } }],
    customer_email: email,
    client_reference_id: ref,
    metadata: {
      booking_ref: ref, service: q.svc.name, size, addons: q.addons.map(a => a.name).join(', ').slice(0, 450),
      start: booking.start, dog: booking.dog.name, customer: booking.customer.name,
      total_usd: String(q.total), deposit_usd: String(q.deposit), balance_usd: String(q.balance)
    },
    payment_intent_data: { description: `Fernhill deposit ${ref} (${q.svc.name}, ${booking.dog.name})`, metadata: { booking_ref: ref } },
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
    if (session.livemode) throw new Error('Live-mode session refused');
    db.pending[ref] = booking; persist();
    console.log(`[checkout] ${ref} session ${session.id} for $${q.deposit} (test mode)`);
    res.json({ url: session.url, ref });
  } catch (e) {
    console.error('[checkout] error:', e.message);
    res.status(502).json({ error: 'Could not start Stripe test checkout. Please try again.' });
  }
});

// Return page: confirm the session and fulfill idempotently (the webhook is the primary path).
app.get('/api/checkout/status', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const id = String(req.query.session_id || '');
  if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'Bad session id' });
  try {
    const b = await fulfill(id, 'return-page');
    if (b) return res.json({ status: 'paid', booking: b });
    res.json({ status: 'unpaid' });
  } catch (e) { console.error('[status] error:', e.message); res.status(500).json({ error: 'Could not confirm payment yet.' }); }
});

app.patch('/api/bookings/:id', (req, res) => {
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (typeof req.body.seen === 'boolean') b.seen = req.body.seen;
  if (['completed', 'noshow'].includes(req.body.status) && b.status === 'confirmed') b.status = req.body.status;
  persist(); res.json({ booking: b });
});

app.post('/api/bookings/:id/refund', async (req, res) => {
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status === 'cancelled') return res.json({ booking: b });
  try {
    const r = await stripe.refunds.create({ payment_intent: b.payment.id, metadata: { booking_ref: b.ref } });
    b.status = 'cancelled'; b.payment = { ...b.payment, refundId: r.id, status: 'refunded' };
    persist(); res.json({ booking: b });
  } catch (e) { console.error('[refund] error:', e.message); res.status(502).json({ error: 'Refund failed: ' + e.message }); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, stripe: stripe ? 'test' : 'not-configured', webhook: !!WHSEC }));

// Static app (only the public files, never server/).
const ROOT = path.join(__dirname, '..');
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));

app.listen(PORT, () => console.log(`Fernhill booking server on :${PORT} (Stripe ${stripe ? 'TEST mode' : 'NOT configured'}, webhook ${WHSEC ? 'on' : 'off'})`));
