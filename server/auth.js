// Shared groomer password. The cookie is an HMAC of a fixed label, so it
// stays valid across restarts and never contains the password itself.
const crypto = require('crypto');

const COOKIE = 'fh_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function dashboardPassword() {
  const p = process.env.DASHBOARD_PASSWORD;
  return typeof p === 'string' ? p : '';
}

function passwordConfigured() {
  return dashboardPassword().trim().length > 0;
}

function passwordsMatch(input) {
  const expected = dashboardPassword();
  const given = typeof input === 'string' ? input.slice(0, 500) : '';
  const ha = crypto.createHash('sha256').update(given, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const same = crypto.timingSafeEqual(ha, hb);
  return expected.trim().length > 0 && same;
}

function sessionToken() {
  const secret = dashboardPassword();
  if (!secret.trim()) return '';
  return crypto.createHmac('sha256', secret).update('fernhill-dashboard-v1').digest('base64url');
}

function sessionValid(token) {
  const expected = sessionToken();
  const a = crypto.createHash('sha256').update(String(token ?? ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return !!expected && crypto.timingSafeEqual(a, b);
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    secure: !!(req && req.secure),
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS
  };
}

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); }
      catch (e) { return ''; }
    }
  }
  return '';
}

module.exports = {
  COOKIE, MAX_AGE_MS, passwordConfigured, passwordsMatch, sessionToken, sessionValid, cookieOptions, readCookie
};
