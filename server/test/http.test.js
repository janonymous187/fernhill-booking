const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const SERVER = path.join(__dirname, '..', 'server.js');
const ROOT = path.join(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function request(port, urlPath, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitFor(fn, ms = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    try { if (await fn()) return; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 50));
  }
  throw last || new Error('timed out');
}

async function startServer(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
  const port = await freePort();
  const password = extra.password == null ? '' : extra.password;
  const child = spawn(process.execPath, [SERVER], {
    cwd: path.join(__dirname, '..'),
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      PORT: String(port),
      DATA_DIR: dir,
      STRIPE_SECRET_KEY: extra.key || '',
      STRIPE_WEBHOOK_SECRET: extra.webhook || '',
      DASHBOARD_PASSWORD: password,
      STRIPE_API_BASE: extra.apiBase || '',
      PUBLIC_URL: 'http://127.0.0.1:' + port
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  try {
    await waitFor(async () => (await request(port, '/healthz')).status === 200);
  } catch (e) {
    child.kill('SIGTERM');
    throw e;
  }
  return {
    port, dir, password,
    logs: () => logs,
    stop() {
      child.kill('SIGTERM');
      return new Promise(resolve => child.once('exit', resolve));
    }
  };
}

test('public routes stay open when the dashboard password is not set', { timeout: 20000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    bookings: [{
      id: 'b-secret', ref: 'FH-KEEP1', status: 'confirmed', start: '2026-12-01T15:00:00.000Z', minutes: 90, deposit: 40,
      dog: { name: 'SecretDog' }, customer: { name: 'Hidden Person', email: 'hidden@example.com' }
    }],
    pending: {}
  }));
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: path.join(__dirname, '..'),
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      PORT: String(port),
      DATA_DIR: dir,
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      PUBLIC_URL: 'http://127.0.0.1:' + port
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { child.kill('SIGTERM'); });
  await waitFor(async () => (await request(port, '/healthz')).status === 200);

  const health = await request(port, '/healthz');
  assert.deepEqual(health.json, { ok: true, stripe: 'not-configured', webhook: false });

  const home = await request(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Fernhill/);
  assert.equal((await request(port, '/styles.css')).status, 200);
  assert.equal((await request(port, '/js/app.js')).status, 200);

  const session = await request(port, '/api/session');
  assert.equal(session.json.available, false);
  assert.equal(session.json.signedIn, false);

  for (const call of [
    ['GET', '/api/state'],
    ['PUT', '/api/config'],
    ['PATCH', '/api/bookings/b-secret'],
    ['POST', '/api/bookings/b-secret/refund']
  ]) {
    const res = await request(port, call[1], { method: call[0], body: call[0] === 'GET' ? null : {} });
    assert.equal(res.status, 403, call.join(' '));
    assert.equal(res.text.includes('SecretDog'), false);
    assert.equal(res.text.includes('hidden@example.com'), false);
  }

  const checkout = await request(port, '/api/checkout', { method: 'POST', body: {} });
  assert.equal(checkout.status, 503);
  const status = await request(port, '/api/checkout/status?session_id=cs_test_abc');
  assert.notEqual(status.status, 401);
  assert.notEqual(status.status, 403);
  const hook = await request(port, '/api/webhook', { method: 'POST', body: {} });
  assert.equal(hook.status, 503);

  const login = await request(port, '/api/login', { method: 'POST', body: { password: 'nope' } });
  assert.equal(login.status, 401);
  assert.equal(login.json.error, "That password isn't right.");
  assert.equal(JSON.stringify(login.json).includes('DASHBOARD'), false);

  const catalog = await request(port, '/api/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.json.bookings, undefined);
  assert.equal(catalog.text.includes('SecretDog'), false);
  assert.equal(catalog.text.includes('hidden@example.com'), false);
  assert.equal(catalog.json.busy.length, 1);
  assert.equal(catalog.json.busy[0].minutes, 90);
  assert.ok(catalog.json.config.services.some(s => s.id === 'full'));
});

test('dashboard cookie is httpOnly and wrong passwords stay vague', { timeout: 20000 }, async (t) => {
  const password = 'pw-' + crypto.randomBytes(8).toString('hex');
  const srv = await startServer({ password });
  t.after(() => srv.stop());

  const locked = await request(srv.port, '/api/state');
  assert.equal(locked.status, 401);
  const catalog = await request(srv.port, '/api/catalog');
  assert.equal(catalog.status, 200);

  const wrong = await request(srv.port, '/api/login', { method: 'POST', body: { password: 'not-the-password' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "That password isn't right.");
  assert.equal(wrong.headers['set-cookie'], undefined);

  const good = await request(srv.port, '/api/login', {
    method: 'POST',
    body: { password },
    headers: { 'X-Forwarded-Proto': 'https' }
  });
  assert.equal(good.status, 200);
  const setCookie = [].concat(good.headers['set-cookie'] || []).join(';');
  assert.match(setCookie, /fh_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.equal(setCookie.includes(password), false);
  assert.equal(srv.logs().includes(password), false);
  const cookie = setCookie.split(';')[0];
  assert.equal(srv.logs().includes(cookie.split('=')[1]), false);

  const state = await request(srv.port, '/api/state', { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.ok(Array.isArray(state.json.bookings));

  const saved = await request(srv.port, '/api/config', {
    method: 'PUT',
    headers: { cookie },
    body: state.json.config
  });
  assert.equal(saved.status, 200);

  const bye = await request(srv.port, '/api/logout', { method: 'POST', headers: { cookie, 'X-Forwarded-Proto': 'https' } });
  assert.equal(bye.status, 200);
  const cleared = [].concat(bye.headers['set-cookie'] || []).join(';');
  assert.match(cleared, /fh_session=/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
  const again = await request(srv.port, '/api/state');
  assert.equal(again.status, 401);
});

test('a live-shaped key is accepted and an invalid key is refused, without printing the key', { timeout: 20000 }, async () => {
  const liveKey = 'sk_live_x';
  const srv = await startServer({ key: liveKey, apiBase: 'http://127.0.0.1:9', password: 'pw-' + crypto.randomBytes(4).toString('hex') });
  try {
    const health = await request(srv.port, '/healthz');
    assert.equal(health.json.stripe, 'live');
    assert.equal(health.json.ok, true);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(srv.logs().includes(liveKey), false);
  } finally {
    await srv.stop();
  }

  const badKey = 'sk_not_valid';
  const refused = spawnSync(process.execPath, [SERVER], {
    cwd: path.join(__dirname, '..'),
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      PORT: '9',
      STRIPE_SECRET_KEY: badKey,
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fh-bad-'))
    },
    encoding: 'utf8'
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /test key|live key/);
  assert.equal((refused.stderr + refused.stdout).includes(badKey), false);
});

test('gitignore and env example do not carry secrets', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /(^|\n)\.env(\n|$)/);
  assert.match(ignore, /node_modules\//);
  assert.match(ignore, /data\//);
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(example, /^DASHBOARD_PASSWORD=$/m);
  assert.match(example, /^DATA_DIR=$/m);
  assert.doesNotMatch(example, /sk_(?:live|test)_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(example, /whsec_[A-Za-z0-9]{8,}/);
});
