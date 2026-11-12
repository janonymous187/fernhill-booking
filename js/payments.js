/*
 * Payment provider layer.
 *
 * The booking flow only talks to `window.Payments`, never to a processor directly.
 * When served by server/server.js, deposits go through Stripe-hosted Checkout in TEST MODE
 * (StripeTestProvider). Opened from file:// with no server, it falls back to DemoProvider
 * (no card data collected, no money moves).
 * Payouts to a bank account are configured in the Stripe dashboard by the business owner.
 */
(function () {
  const DemoProvider = {
    name: 'demo',
    label: 'Demo checkout',
    // Returns an "intent" the UI can confirm. Mirrors Stripe's PaymentIntent shape.
    async createDepositIntent({ amountCents, currency = 'usd', bookingRef }) {
      return { id: 'pi_demo_' + Math.random().toString(36).slice(2, 12), amountCents, currency, bookingRef, status: 'requires_confirmation' };
    },
    mountPaymentUI(/* containerEl, intent */) { /* demo uses a static test-card row */ },
    async confirmDeposit(intent) {
      await new Promise(r => setTimeout(r, 1100));
      return { ...intent, status: 'succeeded', method: 'Test card •••• 4242', provider: 'demo', paidAt: new Date().toISOString() };
    },
    async refundDeposit(paymentId) {
      await new Promise(r => setTimeout(r, 400));
      return { id: 're_demo_' + Math.random().toString(36).slice(2, 10), paymentId, status: 'succeeded' };
    }
  };

  // Stripe-hosted Checkout in TEST MODE. The server creates the Checkout Session (secret key stays server-side)
  // and prices the deposit itself; the browser only redirects to the Stripe-hosted page.
  const StripeTestProvider = {
    name: 'stripe-test',
    label: 'Stripe test checkout',
    async startCheckout(payload) {
      const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { const e = new Error(j.error || 'Could not start checkout'); e.code = j.code; throw e; }
      return j;
    },
    async checkStatus(sessionId) {
      const r = await fetch('/api/checkout/status?session_id=' + encodeURIComponent(sessionId), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not confirm payment');
      return j;
    },
    async refundBooking(bookingId) {
      const r = await fetch('/api/bookings/' + encodeURIComponent(bookingId) + '/refund', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Refund failed');
      return j.booking;
    }
  };

  let active = DemoProvider;
  window.Payments = {
    use(p) { active = p; },
    Demo: DemoProvider,
    StripeTest: StripeTestProvider,
    get provider() { return active; },
    createDepositIntent: (a) => active.createDepositIntent(a),
    mountPaymentUI: (el, i) => active.mountPaymentUI(el, i),
    confirmDeposit: (i) => active.confirmDeposit(i),
    refundDeposit: (id) => active.refundDeposit(id)
  };
})();
