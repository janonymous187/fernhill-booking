// Creates (or reuses) a webhook endpoint for PUBLIC_URL/api/webhook and writes its secret to server/.env.
// Safe to run with a test key or a live key. The secret is written to .env and never printed.
const fs = require('fs'), path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) {}
const Stripe = require('stripe');
const { stripeModeFromKey, redact } = require('./stripe-mode');
const key = process.env.STRIPE_SECRET_KEY, base = (process.argv[2] || process.env.PUBLIC_URL || '').replace(/\/$/, '');
const mode = stripeModeFromKey(key || '');
if (mode !== 'test' && mode !== 'live') { console.error('Need a Stripe test or live key in STRIPE_SECRET_KEY'); process.exit(1); }
if (!/^https:\/\//.test(base)) { console.error('Usage: npm run setup-webhook -- https://your-public-url'); process.exit(1); }
const stripe = new Stripe(key);
(async () => {
  const url = base + '/api/webhook';
  const ep = await stripe.webhookEndpoints.create({
    url,
    description: `Fernhill bookings (${mode})`,
    enabled_events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']
  });
  const envPath = path.join(__dirname, '.env');
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  env = env.replace(/^STRIPE_WEBHOOK_SECRET=.*\n?/m, '').replace(/^PUBLIC_URL=.*\n?/m, '');
  env += `${env && !env.endsWith('\n') ? '\n' : ''}PUBLIC_URL=${base}\nSTRIPE_WEBHOOK_SECRET=${ep.secret}\n`;
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  console.log(`Webhook endpoint ${ep.id} → ${url} (secret saved to server/.env)`);
})().catch(e => { console.error(redact(e.message)); process.exit(1); });
