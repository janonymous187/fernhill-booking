const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const catalog = require('../catalog');
const { stripeModeFromKey, redact } = require('../stripe-mode');
const auth = require('../auth');
const { metadataFromBooking, bookingFromSession, mergeBookings, recoverBookings, META_LIMIT, KEY_LIMIT } = require('../booking-record');

const KNOWN_SESSION = 'cs_test_a0EyPWe5XJNGtyu7SelRmKBw8XvDUqm7fQbSGcsvU7T24GS9TlCbtIZq5M';

test('stripe key mode accepts test, live, or empty and rejects anything else', () => {
  assert.equal(stripeModeFromKey(''), 'not-configured');
  assert.equal(stripeModeFromKey(undefined), 'not-configured');
  assert.equal(stripeModeFromKey('sk_test_x'), 'test');
  assert.equal(stripeModeFromKey('rk_test_x'), 'test');
  assert.equal(stripeModeFromKey('sk_live_x'), 'live');
  assert.equal(stripeModeFromKey('rk_live_x'), 'live');
  assert.equal(stripeModeFromKey('sk_bad'), 'invalid');
  assert.equal(stripeModeFromKey('pk_test_x'), 'invalid');
});

test('redact hides key-shaped strings', () => {
  const raw = 'failed sk_test_x and whsec_abc';
  const out = redact(raw);
  assert.equal(out.includes('sk_test_x'), false);
  assert.equal(out.includes('whsec_abc'), false);
});

test('password check is timing-safe and refuses an empty setting', () => {
  const previous = process.env.DASHBOARD_PASSWORD;
  try {
    delete process.env.DASHBOARD_PASSWORD;
    assert.equal(auth.passwordConfigured(), false);
    assert.equal(auth.passwordsMatch(''), false);
    assert.equal(auth.passwordsMatch('anything'), false);
    const pw = crypto.randomBytes(12).toString('hex');
    process.env.DASHBOARD_PASSWORD = pw;
    assert.equal(auth.passwordsMatch(pw), true);
    assert.equal(auth.passwordsMatch(pw + 'x'), false);
    assert.equal(auth.sessionValid(auth.sessionToken()), true);
    const token = auth.sessionToken();
    process.env.DASHBOARD_PASSWORD = crypto.randomBytes(12).toString('hex');
    assert.equal(auth.sessionValid(token), false);
  } finally {
    if (previous == null) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = previous;
  }
});

function sampleBooking() {
  return {
    id: 'b123', ref: 'FH-AB2C3', createdAt: '2026-11-12T15:00:00.000Z', source: 'online', status: 'confirmed',
    serviceId: 'bath', serviceName: 'Bath & Tidy', size: 'medium', minutes: 90,
    start: '2026-11-20T15:00:00.000Z', total: 80, deposit: 40, balance: 40,
    addons: [{ id: 'teeth', name: 'Teeth brushing', price: 12 }],
    dog: { name: 'Pepper', breed: 'Schnauzer', age: '4', notes: 'Keep the beard' },
    customer: { name: 'Ada Lovelace', phone: '5125550100', email: 'ada@example.com' },
    address: { street: '12 Oak St', unit: 'B', city: 'Austin', zip: '78704', access: 'Gate is open' }
  };
}

test('checkout metadata round-trips every booking field within Stripe limits', () => {
  const original = sampleBooking();
  const meta = metadataFromBooking(original);
  const keys = Object.keys(meta);
  assert.ok(keys.length > 0 && keys.length <= 50);
  for (const [k, v] of Object.entries(meta)) {
    assert.ok(k.length <= KEY_LIMIT);
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0 && v.length <= META_LIMIT);
  }
  const session = {
    id: 'cs_test_roundtrip', status: 'complete', payment_status: 'paid', livemode: false,
    amount_total: 4000, created: 1763000000, metadata: meta,
    payment_intent: { id: 'pi_roundtrip', amount: 4000, amount_refunded: 0 }
  };
  const back = bookingFromSession(session, catalog.defaults());
  assert.equal(back.ref, original.ref);
  assert.equal(back.id, original.id);
  assert.equal(back.serviceId, original.serviceId);
  assert.equal(back.serviceName, original.serviceName);
  assert.equal(back.size, original.size);
  assert.equal(back.minutes, original.minutes);
  assert.equal(back.start, original.start);
  assert.equal(back.total, original.total);
  assert.equal(back.deposit, 40);
  assert.equal(back.balance, original.balance);
  assert.deepEqual(back.addons, original.addons);
  assert.deepEqual(back.dog, original.dog);
  assert.deepEqual(back.customer, original.customer);
  assert.deepEqual(back.address, original.address);
  assert.equal(back.payment.sessionId, session.id);
  assert.equal(back.payment.provider, 'stripe-test');
});

test('an older paid session still rebuilds, including the $40 FH-DD4E3 deposit', () => {
  const session = {
    id: KNOWN_SESSION,
    status: 'complete',
    payment_status: 'paid',
    livemode: false,
    amount_total: 4000,
    created: 1730000000,
    client_reference_id: 'FH-DD4E3',
    customer_email: 'owner@example.com',
    metadata: {
      booking_ref: 'FH-DD4E3',
      service: 'Bath & Tidy',
      size: 'medium',
      addons: 'Teeth brushing',
      start: '2026-11-20T15:00:00.000Z',
      dog: 'Pepper',
      customer: 'Ada Lovelace',
      total_usd: '80',
      deposit_usd: '40',
      balance_usd: '40'
    },
    payment_intent: { id: 'pi_known', amount: 4000, amount_refunded: 0, latest_charge: { payment_method_details: { card: { brand: 'visa', last4: '4242' } } } }
  };
  const rebuilt = bookingFromSession(session, catalog.defaults());
  assert.equal(rebuilt.ref, 'FH-DD4E3');
  assert.equal(rebuilt.deposit, 40);
  assert.equal(rebuilt.serviceId, 'bath');
  assert.equal(rebuilt.minutes, 90);
  assert.equal(rebuilt.dog.name, 'Pepper');
  assert.equal(rebuilt.customer.email, 'owner@example.com');
  assert.equal(rebuilt.addons[0].name, 'Teeth brushing');
  assert.equal(rebuilt.payment.method, 'Visa •••• 4242');

  const local = [{
    id: 'b-local', ref: 'FH-DD4E3', status: 'completed', seen: true, deposit: 40, total: 80, balance: 40,
    minutes: 90, serviceName: 'Bath & Tidy', serviceId: 'bath', start: session.metadata.start,
    dog: { name: 'Pepper' }, customer: { name: 'Ada Lovelace', email: 'owner@example.com' },
    address: { street: '9 Pine' }, addons: [],
    payment: { sessionId: KNOWN_SESSION, id: 'pi_known', status: 'succeeded' }
  }];
  const merged = recoverBookings(local, [session, session], catalog.defaults());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'b-local');
  assert.equal(merged[0].status, 'completed');
  assert.equal(merged[0].seen, true);
  assert.equal(merged[0].deposit, 40);
  assert.equal(merged[0].address.street, '9 Pine');

  const wiped = recoverBookings([], [session], catalog.defaults());
  assert.equal(wiped.length, 1);
  assert.equal(wiped[0].ref, 'FH-DD4E3');
  assert.equal(wiped[0].deposit, 40);
  assert.equal(recoverBookings(wiped, [session], catalog.defaults()).length, 1);
});

test('unpaid sessions and fully refunded payments are not treated as open deposits', () => {
  assert.equal(bookingFromSession({ id: 'cs_test_open', status: 'open', payment_status: 'unpaid', metadata: { booking_ref: 'FH-ZZZZ1' } }), null);
  const refunded = bookingFromSession({
    id: 'cs_test_refunded', status: 'complete', payment_status: 'paid', amount_total: 2000, livemode: false,
    metadata: { booking_ref: 'FH-ZZZZ2', deposit_usd: '20', total_usd: '20', balance_usd: '0', service_name: 'Nail Trim & Grind', dog_name: 'Gus' },
    payment_intent: { id: 'pi_ref', amount: 2000, amount_refunded: 2000 }
  }, catalog.defaults());
  assert.equal(refunded.status, 'cancelled');
  assert.equal(refunded.payment.status, 'refunded');
  const kept = mergeBookings([{ ref: 'FH-OTHER', id: 'b9', payment: { sessionId: 'cs_test_other' } }], [refunded]);
  assert.equal(kept.length, 2);
});
