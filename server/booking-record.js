// Encode a confirmed booking into Stripe metadata, and build it back.
// Stripe allows 50 keys and 500 characters per value. Empty values are omitted
// because Stripe treats them as an attempt to unset the key.
const crypto = require('crypto');

const META_LIMIT = 500;
const KEY_LIMIT = 40;
const STATUSES = new Set(['confirmed', 'completed', 'cancelled', 'noshow']);

function clip(value) {
  const s = String(value ?? '');
  return s.length > META_LIMIT ? s.slice(0, META_LIMIT) : s;
}

function put(meta, key, value) {
  if (value == null || key.length > KEY_LIMIT) return;
  const s = clip(value).trim();
  if (!s) return;
  meta[key] = s;
}

function metadataFromBooking(b) {
  const meta = {};
  const dog = (b && b.dog) || {};
  const customer = (b && b.customer) || {};
  const address = (b && b.address) || {};
  put(meta, 'booking_ref', b.ref);
  put(meta, 'booking_id', b.id);
  put(meta, 'created_at', b.createdAt);
  put(meta, 'source', b.source || 'online');
  put(meta, 'service_id', b.serviceId);
  put(meta, 'service_name', b.serviceName);
  put(meta, 'size', b.size);
  put(meta, 'minutes', b.minutes);
  put(meta, 'start', b.start);
  put(meta, 'total_usd', b.total);
  put(meta, 'deposit_usd', b.deposit);
  put(meta, 'balance_usd', b.balance);
  put(meta, 'booking_status', b.status || 'confirmed');
  if (Array.isArray(b.addons) && b.addons.length) {
    const items = b.addons.map(a => ({ id: a.id, name: a.name, price: a.price }));
    let json = JSON.stringify(items);
    while (json.length > META_LIMIT && items.length) {
      items.pop();
      json = JSON.stringify(items);
    }
    if (items.length) put(meta, 'addons_json', json);
  }
  put(meta, 'dog_name', dog.name);
  put(meta, 'dog_breed', dog.breed);
  put(meta, 'dog_age', dog.age);
  put(meta, 'dog_notes', dog.notes);
  put(meta, 'customer_name', customer.name);
  put(meta, 'customer_phone', customer.phone);
  put(meta, 'customer_email', customer.email);
  put(meta, 'addr_street', address.street);
  put(meta, 'addr_unit', address.unit);
  put(meta, 'addr_city', address.city);
  put(meta, 'addr_zip', address.zip);
  put(meta, 'addr_access', address.access);
  return meta;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseAddons(meta) {
  if (meta.addons_json) {
    try {
      const arr = JSON.parse(meta.addons_json);
      if (Array.isArray(arr)) {
        return arr.filter(a => a && (a.name || a.id)).map(a => ({
          id: String(a.id || ''),
          name: String(a.name || ''),
          price: num(a.price)
        }));
      }
    } catch (e) { /* use the older comma-separated names */ }
  }
  if (meta.addons) {
    return String(meta.addons).split(',').map(s => s.trim()).filter(Boolean)
      .map(name => ({ id: '', name, price: 0 }));
  }
  return [];
}

function cardMethod(pi) {
  const charge = pi && pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const card = charge && charge.payment_method_details && charge.payment_method_details.card;
  if (!card || !card.brand || !card.last4) return 'Card';
  return `${card.brand[0].toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}`;
}

// Paid Checkout sessions are the ones we can rebuild. "fulfilled" is accepted
// in case a session reports that instead of "paid".
function isPaidSession(session) {
  if (!session) return false;
  if (session.status && session.status !== 'complete') return false;
  return session.payment_status === 'paid' || session.payment_status === 'fulfilled';
}

function bookingFromSession(session, config) {
  if (!isPaidSession(session)) return null;
  const m = session.metadata || {};
  const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const piMeta = (pi && pi.metadata) || {};
  const ref = m.booking_ref || piMeta.booking_ref || session.client_reference_id || '';
  if (!ref) return null;
  const services = (config && config.services) || [];
  let serviceId = m.service_id || piMeta.service_id || '';
  let serviceName = m.service_name || m.service || piMeta.service_name || '';
  if (!serviceId && serviceName) {
    const svc = services.find(s => s.name === serviceName);
    if (svc) serviceId = svc.id;
  }
  if (!serviceName && serviceId) {
    const svc = services.find(s => s.id === serviceId);
    if (svc) serviceName = svc.name;
  }
  if (!serviceName) serviceName = 'Groom';
  let minutes = num(m.minutes || piMeta.minutes, 0);
  if (!minutes) {
    const svc = services.find(s => s.id === serviceId || s.name === serviceName);
    minutes = svc ? svc.minutes : 60;
  }
  const paid = session.amount_total != null ? session.amount_total / 100 : num(m.deposit_usd || piMeta.deposit_usd);
  const total = (m.total_usd != null && m.total_usd !== '') ? num(m.total_usd)
    : ((piMeta.total_usd != null && piMeta.total_usd !== '') ? num(piMeta.total_usd) : paid);
  const balance = (m.balance_usd != null && m.balance_usd !== '') ? num(m.balance_usd)
    : Math.max(0, Math.round((total - paid) * 100) / 100);
  const details = session.customer_details || {};
  const email = m.customer_email || piMeta.customer_email || session.customer_email || details.email || '';
  const createdSec = session.created || Math.floor(Date.now() / 1000);
  const createdAt = m.created_at || new Date(createdSec * 1000).toISOString();
  const charge = pi && pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const fullyRefunded = !!(pi && pi.amount > 0 && pi.amount_refunded >= pi.amount) || !!(charge && charge.refunded);
  let status = piMeta.booking_status || m.booking_status || 'confirmed';
  if (!STATUSES.has(status)) status = 'confirmed';
  if (fullyRefunded) status = 'cancelled';
  const livemode = !!session.livemode;
  return {
    id: m.booking_id || ('b' + crypto.createHash('sha256').update(String(session.id)).digest('hex').slice(0, 12)),
    ref,
    createdAt,
    source: m.source || 'online',
    seen: (piMeta.booking_seen || m.booking_seen) === '1',
    serviceId,
    serviceName,
    size: m.size || piMeta.size || 'small',
    addons: parseAddons({
      addons_json: m.addons_json || piMeta.addons_json,
      addons: m.addons || piMeta.addons
    }),
    minutes,
    start: m.start || piMeta.start || createdAt,
    total,
    deposit: paid,
    balance,
    dog: {
      name: m.dog_name || m.dog || piMeta.dog_name || '',
      breed: m.dog_breed || piMeta.dog_breed || '',
      age: m.dog_age || piMeta.dog_age || '',
      notes: m.dog_notes || piMeta.dog_notes || ''
    },
    customer: {
      name: m.customer_name || m.customer || piMeta.customer_name || '',
      phone: m.customer_phone || piMeta.customer_phone || '',
      email
    },
    address: {
      street: m.addr_street || piMeta.addr_street || '',
      unit: m.addr_unit || piMeta.addr_unit || '',
      city: m.addr_city || piMeta.addr_city || '',
      zip: m.addr_zip || piMeta.addr_zip || '',
      access: m.addr_access || piMeta.addr_access || ''
    },
    status,
    payment: {
      id: pi ? pi.id : (typeof session.payment_intent === 'string' ? session.payment_intent : ''),
      sessionId: session.id,
      status: status === 'cancelled' ? 'refunded' : 'succeeded',
      method: cardMethod(pi),
      provider: livemode ? 'stripe' : 'stripe-test',
      livemode,
      paidAt: createdAt
    }
  };
}

function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

// Keep the local record (status, seen, ids). Fill blanks from Stripe so a
// restart does not wipe a paid booking or create a second copy of it.
function fillObject(primary, fallback) {
  const out = { ...(fallback || {}), ...(primary || {}) };
  for (const k of Object.keys(fallback || {})) {
    if (isEmpty(out[k]) && !isEmpty(fallback[k])) out[k] = fallback[k];
  }
  return out;
}

function recoverBookings(localBookings, sessions, config) {
  const recovered = (sessions || []).map(s => bookingFromSession(s, config)).filter(Boolean);
  return mergeBookings(localBookings, recovered);
}

function mergeBookings(localList, recoveredList) {
  const out = (localList || []).map(b => ({ ...b }));
  for (const rec of recoveredList || []) {
    if (!rec || !rec.ref) continue;
    const idx = out.findIndex(b =>
      (b.ref && b.ref === rec.ref) ||
      (b.payment && rec.payment && b.payment.sessionId && b.payment.sessionId === rec.payment.sessionId)
    );
    if (idx === -1) {
      out.push(rec);
      continue;
    }
    const local = out[idx];
    const merged = { ...rec, ...local };
    merged.dog = fillObject(local.dog, rec.dog);
    merged.customer = fillObject(local.customer, rec.customer);
    merged.address = fillObject(local.address, rec.address);
    merged.payment = fillObject(local.payment, rec.payment);
    if (!Array.isArray(local.addons) || local.addons.length === 0) merged.addons = rec.addons || [];
    if (isEmpty(local.serviceId)) merged.serviceId = rec.serviceId;
    if (isEmpty(local.serviceName)) merged.serviceName = rec.serviceName;
    if (!local.minutes && rec.minutes) merged.minutes = rec.minutes;
    merged.status = local.status || rec.status;
    merged.seen = local.seen != null ? !!local.seen : !!rec.seen;
    out[idx] = merged;
  }
  return out;
}

module.exports = {
  metadataFromBooking, bookingFromSession, mergeBookings, recoverBookings, isPaidSession, META_LIMIT, KEY_LIMIT
};
