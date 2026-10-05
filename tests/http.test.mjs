import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp, appointmentsCsv } from '../server/http.mjs';
import { hashPassword } from '../server/auth.mjs';

const business = {
  businessName: 'Salone test', email: 'proprietaria@example.test',
  services: [{ id: 'taglio', name: 'Taglio' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => ({ day, label: day, ranges: [{ opens: '09:00', closes: '18:00' }] })),
};
const PASSWORD = 'Una password test 2026!';
const TOKEN = 'activation-token-test-with-more-than-32-characters';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'booking-http-'));
  const staticDir = join(directory, 'dist');
  await mkdir(join(staticDir, 'agenda'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Pubblico</title>');
  await writeFile(join(staticDir, 'agenda', 'index.html'), '<!doctype html><title>Agenda</title>');
  let instant = Date.UTC(2026, 9, 4, 8);
  const config = {
    origin: 'http://booking.test', host: '127.0.0.1', port: 0, dataDir: join(directory, 'data'), staticDir,
    business, bootstrapToken: TOKEN, bootstrapExpiresAt: new Date(instant + 3_600_000).toISOString(), whatsapp: {}, ...overrides,
  };
  const runner = {
    start() {}, stop() {},
    getStatus: () => ({ configured: false, missing: ['WHATSAPP_ACCESS_TOKEN'], dailyLimit: 20, monthlyLimit: 200, sentThisMonth: 0, accessToken: 'NEVER_EXPOSE_TOKEN' }),
    handleWebhook: ({ method, query, rawBody, signature }) => method === 'GET'
      ? { status: 200, body: query.get('hub.challenge') }
      : { status: signature === 'good' ? 200 : 403, body: { ok: signature === 'good', bytes: rawBody.length } },
  };
  const app = createApp({ config, reminderRunner: runner, now: () => instant });
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function call(path, { method = 'GET', body, cookie, csrf, origin = config.origin, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { response, status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const setup = (body = {}) => call('/api/auth/setup', { method: 'POST', body: { token: TOKEN, password: PASSWORD, ...body } });
  return { app, config, base, call, setup, advance: (milliseconds) => { instant += milliseconds; } };
}

test('private APIs require authentication and reserved routes always return JSON', async (t) => {
  const { call } = await fixture(t);
  const denied = await call('/api/admin/appointments');
  assert.equal(denied.status, 401);
  assert.equal(denied.response.headers.get('cache-control'), 'no-store');
  assert.equal(denied.response.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/api/auth/session')).data.setupRequired, true);
  const missing = await call('/api/unknown');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'not_found');
  const config = await call('/api/public/config');
  assert.equal(config.data.bookingEnabled, false);
  assert.deepEqual(config.data.services, []);
  assert.equal(JSON.stringify(config.data).includes('proprietaria'), false);
  assert.equal((await call('/api/health')).data.ok, true);
});

test('bootstrap verifies the expiring secret, enforces password length, and is one-use', async (t) => {
  const { setup, call, app } = await fixture(t);
  assert.equal((await setup({ token: 'incorrect' })).status, 403);
  assert.equal((await setup({ password: 'short' })).status, 400);
  const activated = await setup();
  assert.equal(activated.status, 201);
  assert.equal(activated.data.authenticated, true);
  assert.equal(activated.data.whatsappConfigured, false);
  assert.match(activated.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(activated.response.headers.get('set-cookie'), /Max-Age=43200/);
  assert.equal(activated.response.headers.get('set-cookie').includes('Secure'), false);
  assert.equal((await setup()).status, 409);
  const stored = app.store.db.prepare('SELECT password_hash FROM owners').get().password_hash;
  assert.match(stored, /^scrypt\$/);
  assert.equal(stored.includes(PASSWORD), false);
  const session = await call('/api/auth/session', { cookie: activated.cookie });
  assert.equal(session.data.email, business.email);
  assert.equal(typeof session.data.csrfToken, 'string');
  assert.equal(JSON.stringify(session.data).includes(TOKEN), false);
});

test('expired bootstrap tokens cannot activate an owner', async (t) => {
  const { setup, advance } = await fixture(t);
  advance(3_600_001);
  const result = await setup();
  assert.equal(result.status, 403);
  assert.equal(result.data.error.code, 'setup_expired');
});

test('HTTPS sessions set Secure and agenda aliases never cache or send referrers', async (t) => {
  const { setup, call } = await fixture(t, { origin: 'https://booking.test', production: true });
  const activated = await setup();
  assert.match(activated.response.headers.get('set-cookie'), /; Secure/);
  for (const path of ['/agenda', '/agenda/', '/agenda/index.html', '/agenda?attiva=SECRET', '/agenda//', '/agenda%2f', '/%61genda']) {
    const page = await call(path);
    assert.equal(page.response.headers.get('cache-control'), 'no-store', path);
    assert.equal(page.response.headers.get('referrer-policy'), 'no-referrer', path);
    assert.match(page.response.headers.get('x-robots-tag'), /noindex/, path);
    assert.equal(page.response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal((await call('/server/config.mjs')).status, 404);
});

test('admin mutations need both the same origin and the session CSRF token', async (t) => {
  const { setup, call } = await fixture(t);
  const owner = await setup();
  const change = { method: 'PATCH', cookie: owner.cookie, body: { dailyReminderLimit: 7 } };
  assert.equal((await call('/api/admin/settings', change)).status, 403);
  assert.equal((await call('/api/admin/settings', { ...change, csrf: 'wrong' })).status, 403);
  assert.equal((await call('/api/admin/settings', { ...change, csrf: owner.data.csrfToken, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/api/admin/settings', { ...change, csrf: owner.data.csrfToken, headers: { Origin: '' } })).status, 403);
  const changed = await call('/api/admin/settings', { ...change, csrf: owner.data.csrfToken });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.dailyReminderLimit, 7);
  const status = await call('/api/admin/automation', { cookie: owner.cookie });
  assert.deepEqual(status.data.missing, ['WHATSAPP_ACCESS_TOKEN']);
  assert.equal(JSON.stringify(status.data).includes('NEVER_EXPOSE_TOKEN'), false);
});

test('password change revokes every previous session and logout revokes the new session', async (t) => {
  const { setup, call } = await fixture(t);
  const first = await setup();
  const second = await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD } });
  const newPassword = 'Nuova password sicura 2026!';
  const changed = await call('/api/admin/password', { method: 'POST', cookie: first.cookie, csrf: first.data.csrfToken, body: { currentPassword: PASSWORD, password: newPassword } });
  assert.equal(changed.status, 200);
  for (const old of [first, second]) assert.equal((await call('/api/admin/settings', { cookie: old.cookie })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: newPassword } })).status, 200);
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie: changed.cookie, csrf: changed.data.csrfToken })).status, 200);
  assert.equal((await call('/api/admin/settings', { cookie: changed.cookie })).status, 401);
});

test('sessions expire after twelve hours even when the cookie remains present', async (t) => {
  const { setup, call, advance } = await fixture(t);
  const owner = await setup();
  advance(12 * 3_600_000 + 1);
  const result = await call('/api/auth/session', { cookie: owner.cookie });
  assert.deepEqual(result.data, { authenticated: false, setupRequired: false });
});

test('a password changed during login derivation cannot issue a stale authenticated session', async (t) => {
  const { setup, call, app } = await fixture(t);
  await setup();
  const replacement = await hashPassword('Password sostitutiva molto sicura!');
  const before = app.store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  const transaction = app.store.transaction;
  // Simulate a password rotation committed after verification began but before session issuance.
  app.store.transaction = (callback) => {
    app.store.db.prepare('UPDATE owners SET password_hash = ? WHERE id = 1').run(replacement);
    return transaction(callback);
  };
  const result = await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD } });
  assert.equal(result.status, 401);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, before);
});

test('public bookings enforce JSON, bounded bodies, origin, and request throttling', async (t) => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/public/bookings', { method: 'POST', body: {}, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/api/public/bookings', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('/api/public/bookings', { method: 'POST', body: '[' })).status, 400);
  const oversized = await call('/api/public/bookings', { method: 'POST', body: { name: 'x'.repeat(32 * 1024) } });
  assert.equal(oversized.status, 413);
  for (let i = 0; i < 7; i++) await call('/api/public/bookings', { method: 'POST', body: {} });
  const limited = await call('/api/public/bookings', { method: 'POST', body: {} });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
});

test('chunked bodies are rejected at the same size boundary as declared lengths', async (t) => {
  const { base, config } = await fixture(t);
  const result = await new Promise((resolveResult, reject) => {
    const req = httpRequest(base + '/api/public/bookings', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolveResult({ status: response.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write('{"name":"' + 'x'.repeat(20_000));
    req.end('x'.repeat(20_000) + '"}');
  });
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, 'body_too_large');
});

test('Railway client IP limits are independent and forwarded-header spoofing cannot bypass them', async (t) => {
  const { call } = await fixture(t, { trustProxy: 'railway' });
  const book = (headers) => call('/api/public/bookings', { method: 'POST', body: {}, headers });
  for (let i = 0; i < 10; i++) {
    assert.notEqual((await book({ 'x-real-ip': '198.51.100.10' })).status, 429);
  }
  assert.equal((await book({ 'x-real-ip': '198.51.100.10' })).status, 429);
  assert.notEqual((await book({ 'x-real-ip': '198.51.100.20' })).status, 429);
  // A valid Railway client IP remains the key even when X-Forwarded-For changes.
  assert.equal((await book({ 'x-real-ip': '198.51.100.10', 'x-forwarded-for': '203.0.113.99' })).status, 429);
  for (let i = 0; i < 10; i++) {
    assert.notEqual((await book({ 'x-forwarded-for': `203.0.113.${i + 1}` })).status, 429);
  }
  assert.equal((await book({ 'x-forwarded-for': '203.0.113.200' })).status, 429);
  // Invalid X-Real-IP values fall back to the socket, rather than creating new buckets.
  assert.equal((await book({ 'x-real-ip': 'not-an-ip' })).status, 429);
  assert.equal((await book({ 'x-real-ip': '198.51.100.30, 198.51.100.40' })).status, 429);
});

test('failed logins from one client cannot exhaust the owner login budget of other clients', async (t) => {
  const { call, setup } = await fixture(t, { trustProxy: 'railway' });
  assert.equal((await setup()).status, 201);
  const login = (ip, password = 'password sbagliata 2026') => call('/api/auth/login', { method: 'POST', body: { email: business.email, password }, headers: { 'x-real-ip': ip } });
  for (let index = 0; index < 5; index++) assert.equal((await login('198.51.100.66')).status, 401);
  for (let index = 0; index < 150; index++) assert.equal((await login('198.51.100.66')).status, 429);
  assert.equal((await login('198.51.100.7', PASSWORD)).status, 200);
});

test('webhook challenge and raw signature delivery work independently of browser Origin', async (t) => {
  const { call } = await fixture(t);
  const challenge = await call('/api/whatsapp/webhook?hub.challenge=123456');
  assert.equal(challenge.status, 200);
  assert.equal(challenge.data, 123456);
  const delivery = await call('/api/whatsapp/webhook', { method: 'POST', body: { entry: [] }, headers: { 'x-hub-signature-256': 'good', Origin: '' } });
  assert.equal(delivery.status, 200);
  assert.equal(delivery.data.ok, true);
  assert.equal((await call('/api/whatsapp/webhook', { method: 'POST', body: {} })).status, 403);
});

test('CSV export quotes data and neutralizes spreadsheet formulas', () => {
  const csv = appointmentsCsv([{ reference: 'DD-123', status: 'confirmed', title: 'Taglio, piega', date: '2026-10-05', time: '09:00', durationMinutes: 30, name: '=HYPERLINK("bad")', phone: '+393501234567', reminderConsent: true }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"\'+393501234567"'));
  assert.ok(csv.includes('"Taglio, piega"'));
  // Italian Excel: semicolon separators, Italian labels and day/month/year dates.
  assert.ok(csv.split('\r\n')[0].includes('"Riferimento";"Stato"'));
  assert.ok(csv.includes('"Confermato";"In programma"'));
  assert.ok(csv.includes('"05/10/2026"'));
});

test('a new private access link resets a forgotten password once and closes every old session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-reset-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const staticDir = join(directory, 'dist');
  await mkdir(staticDir, { recursive: true });
  let instant = Date.UTC(2026, 9, 4, 8);
  async function start(bootstrapToken) {
    const config = { origin: 'http://booking.test', host: '127.0.0.1', port: 0, dataDir: join(directory, 'data'), staticDir, business,
      bootstrapToken, bootstrapExpiresAt: new Date(instant + 3_600_000).toISOString(), whatsapp: {} };
    const runner = { start() {}, stop() {}, getStatus: () => ({ configured: false, missing: [] }), handleWebhook: () => ({ status: 404, body: {} }) };
    const app = createApp({ config, reminderRunner: runner, now: () => instant });
    const { port } = await app.start();
    const call = async (path, body, cookie) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: config.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
    };
    return { app, call };
  }
  const first = await start(TOKEN);
  const activated = await first.call('/api/auth/setup', { token: TOKEN, password: PASSWORD });
  assert.equal(activated.status, 201);
  const oldCookie = activated.cookie.split(';')[0];
  assert.equal((await first.call('/api/auth/setup', { token: TOKEN, password: 'Un altra password 2026!' })).status, 409);
  await first.app.close();

  // The operator configures a new link: it sets a new password once.
  const NEW_TOKEN = 'second-private-link-for-a-forgotten-password-2026';
  const second = await start(NEW_TOKEN);
  assert.equal((await second.call('/api/auth/setup', { token: TOKEN, password: 'Tentativo vecchio link 2026' })).status, 403);
  const reset = await second.call('/api/auth/setup', { token: NEW_TOKEN, password: 'Nuova password sicura 2026', remember: true });
  assert.equal(reset.status, 201);
  assert.equal(reset.data.authenticated, true);
  assert.match(reset.cookie, /Max-Age=2592000/);
  assert.equal((await second.call('/api/auth/session', undefined, oldCookie)).data.authenticated, false);
  assert.equal((await second.call('/api/auth/login', { email: business.email, password: PASSWORD })).status, 401);
  assert.equal((await second.call('/api/auth/login', { email: business.email, password: 'Nuova password sicura 2026' })).status, 200);
  assert.equal((await second.call('/api/auth/setup', { token: NEW_TOKEN, password: 'Terza password sicura 2026' })).status, 409);
  const events = second.app.store.db.prepare("SELECT event FROM audit_log WHERE event LIKE 'owner_%' ORDER BY id").all().map((row) => row.event);
  assert.deepEqual(events, ['owner_setup', 'owner_access_reset']);
  await second.app.close();
});

test('an agenda activated before link tracking never turns its original link into a reset link', async (t) => {
  const { app, setup } = await fixture(t);
  assert.equal((await setup()).status, 201);
  // Simulate the database of an earlier version: no record of used links.
  app.store.db.prepare("DELETE FROM settings WHERE key = 'owner_access_links_used'").run();
  const { createAuth } = await import('../server/auth.mjs');
  const auth = createAuth({ store: app.store, config: { origin: 'http://booking.test', business, bootstrapToken: TOKEN, bootstrapExpiresAt: new Date(Date.UTC(2026, 9, 4, 9)).toISOString() }, now: () => Date.UTC(2026, 9, 4, 8) });
  await assert.rejects(() => auth.setup({ token: TOKEN, password: 'Password di ripristino 2026' }), { code: 'setup_completed' });
});

test('remembered sessions last thirty days and the default session still lasts twelve hours', async (t) => {
  const { call, setup } = await fixture(t);
  assert.equal((await setup()).status, 201);
  const short = await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD } });
  assert.match(short.response.headers.get('set-cookie'), /Max-Age=43200/);
  const long = await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD, remember: true } });
  assert.match(long.response.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD, remember: 'yes' } })).status, 400);
});
