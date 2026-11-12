# Fernhill Mobile Grooming — booking & deposit app

- `#/` customer booking flow (service → date/time → dog/address/contact → review → Stripe Checkout → confirmation)
- `#/dashboard` groomer bookings (password required when the app is served by the server)

## Run
```
cd server
npm install
cp .env.example .env        # STRIPE_SECRET_KEY and DASHBOARD_PASSWORD. Do not commit .env.
npm start                   # http://localhost:8787
npm test
npm run setup-webhook -- https://<public-url>   # saves the webhook secret to .env; restart after
```

Set `DASHBOARD_PASSWORD` on the host before taking real customers. If it is missing, the bookings page stays closed.
`STRIPE_SECRET_KEY` may be a test key (`rk_test_` / `sk_test_`) or, later, a live key (`rk_live_` / `sk_live_`).
An empty key still starts the server with payments turned off. Other key shapes are refused.
Secrets live only in `server/.env` (gitignored), never in the browser.

Restricted key permissions needed: Checkout Sessions (read and write), PaymentIntents (read), Charges (read), Refunds (write),
and Webhook Endpoints (write) only if you use `setup-webhook`.

How it works: the server re-prices the deposit from its own copy of prices/rules (30% of total, rounded to $5, $20 minimum,
editable in the dashboard), creates a Checkout Session with the booking in metadata, and confirms the booking on
`checkout.session.completed` / `checkout.session.async_payment_succeeded` (only when paid). The return page also confirms
idempotently. Paid bookings are copied into `db.json` and, if that file is wiped, rebuilt from paid Checkout sessions in Stripe.
`DATA_DIR` can point that file at another folder; it is optional.

Test card, while the key is a test key: 4242 4242 4242 4242, any future expiry, any CVC, any ZIP.

Opening `index.html` from file:// still works with the old simulated demo payment.
