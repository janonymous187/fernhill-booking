// How the server treats STRIPE_SECRET_KEY. Empty is allowed (payments off).
// Anything other than a test or live secret/restricted key is rejected at startup.

function stripeModeFromKey(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return 'not-configured';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  return 'invalid';
}

function redact(message) {
  return String(message ?? '').replace(/\b((?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)/g, '[redacted]');
}

module.exports = { stripeModeFromKey, redact };
