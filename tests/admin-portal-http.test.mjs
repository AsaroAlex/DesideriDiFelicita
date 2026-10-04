import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHmac } from 'node:crypto';
import { createApp } from '../server/http.mjs';
import { createStore } from '../server/db.mjs';
import { createWhatsappSettings } from '../server/whatsapp-settings.mjs';
import { createReminderRunner } from '../server/reminders.mjs';
import { localDateTimeToEpoch } from '../server/time.mjs';

const PASSWORD = 'Password owner test molto sicura!';
const TOKEN = 'bootstrap-token-owner-test-at-least-32-characters';
const business = {
  businessName: 'Salone test', email: 'owner@example.test', services: [{ id: 'taglio', name: 'Taglio' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map((day) => ({ day, label: day, ranges: [{ opens: '09:00', closes: '20:00' }] })),
};
const credentials = {
  accessToken: 'owner-access-token-only-a-fixture', phoneNumberId: '123456789',
  templateName: 'promemoria_appuntamento', templateLanguage: 'it', graphVersion: 'v26.0',
  appSecret: 'owner-application-secret-only-a-fixture', verifyToken: 'owner-verification-token-only-a-fixture',
};

async function fixture(t, patch = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'desideri-admin-api-test-'));
  const staticDir = join(directory, 'dist');
  await mkdir(join(staticDir, 'admin'), { recursive: true });
  await mkdir(join(staticDir, 'agenda'), { recursive: true });
  await writeFile(join(staticDir, 'admin', 'index.html'), '<!doctype html><title>Admin</title>');
  await writeFile(join(staticDir, 'agenda', 'index.html'), '<!doctype html><title>Agenda</title>');
  const instant = localDateTimeToEpoch('2026-10-04', '17:30');
  const config = {
    origin: 'http://owner.test', host: '127.0.0.1', port: 0, staticDir,
    dataDir: join(directory, 'data'), business, bootstrapToken: TOKEN,
    bootstrapExpiresAt: new Date(instant + 3_600_000).toISOString(), whatsapp: {},
    whatsappConfigKey: randomBytes(32).toString('base64'), ...patch,
  };
  const app = createApp({ config, now: () => instant });
  const address = await app.start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function call(path, { method = 'GET', body, cookie, csrf, origin = config.origin, raw = false } = {}) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, headers: {
        ...(method !== 'GET' ? { Origin: origin } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
    });
    const data = raw ? Buffer.from(await response.arrayBuffer()) : await response.text().then((value) => {
      try { return JSON.parse(value); } catch { return value; }
    });
    return { status: response.status, response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const setup = () => call('/api/auth/setup', { method: 'POST', body: { token: TOKEN, password: PASSWORD } });
  return { directory, app, config, call, setup };
}

test('WhatsApp administration authenticates, rechecks password, encrypts and returns only safe fields', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/admin/whatsapp')).status, 401);
  const owner = await f.setup();
  const auth = { cookie: owner.cookie, csrf: owner.data.csrfToken };
  const initial = await f.call('/api/admin/whatsapp', auth);
  assert.equal(initial.data.storageAvailable, true);
  assert.equal(initial.data.source, 'none');
  assert.equal(initial.data.enabled, false);
  const badPassword = await f.call('/api/admin/whatsapp', { ...auth, method: 'PATCH', body: { currentPassword: 'wrong', enabled: false } });
  assert.equal(badPassword.status, 400);
  assert.equal(badPassword.data.error.code, 'invalid_current_password');
  assert.equal((await f.call('/api/auth/session', auth)).data.authenticated, true);
  assert.equal((await f.call('/api/admin/whatsapp', { ...auth, csrf: undefined, method: 'PATCH', body: { currentPassword: PASSWORD } })).status, 403);
  assert.equal((await f.call('/api/admin/whatsapp', { ...auth, origin: 'https://other.test', method: 'PATCH', body: { currentPassword: PASSWORD } })).status, 403);
  const saved = await f.call('/api/admin/whatsapp', { ...auth, method: 'PATCH', body: { ...credentials, currentPassword: PASSWORD, enabled: false } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.source, 'portal');
  assert.equal(saved.data.configured, true);
  assert.equal(saved.data.webhookConfigured, true);
  assert.equal(saved.data.enabled, false);
  assert.deepEqual(saved.data.secrets, { accessToken: true, appSecret: true, verifyToken: true });
  const privateData = JSON.stringify(saved.data) + JSON.stringify((await f.call('/api/admin/automation', auth)).data) + JSON.stringify((await f.call('/api/auth/session', auth)).data);
  for (const name of ['accessToken', 'appSecret', 'verifyToken']) assert.equal(privateData.includes(credentials[name]), false);
  const encrypted = f.app.store.db.prepare('SELECT ciphertext,iv,auth_tag FROM owner_whatsapp_config').get();
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.auth_tag.length, 16);
  for (const name of ['accessToken', 'appSecret', 'verifyToken']) assert.equal(Buffer.from(encrypted.ciphertext).includes(Buffer.from(credentials[name])), false);
  const enabled = await f.call('/api/admin/whatsapp', { ...auth, method: 'PATCH', body: { currentPassword: PASSWORD, enabled: true } });
  assert.equal(enabled.data.enabled, true);
  assert.equal(enabled.data.phoneNumberId, credentials.phoneNumberId);
  assert.equal((await f.call('/api/admin/automation', auth)).data.enabled, true);
  const disabled = await f.call('/api/admin/whatsapp', { ...auth, method: 'PATCH', body: { currentPassword: PASSWORD, accessToken: '', appSecret: '', verifyToken: '', enabled: false } });
  assert.equal(disabled.data.enabled, false);
  assert.deepEqual(disabled.data.secrets, saved.data.secrets);
});

test('WhatsApp incomplete activation and invalid fields cannot partially mutate a saved configuration', async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const auth = { cookie: owner.cookie, csrf: owner.data.csrfToken, method: 'PATCH' };
  let result = await f.call('/api/admin/whatsapp', { ...auth, body: { currentPassword: PASSWORD, phoneNumberId: '123', enabled: true } });
  assert.equal(result.status, 400);
  assert.equal(result.data.error.code, 'incomplete_whatsapp_configuration');
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS count FROM owner_whatsapp_config').get().count, 0);
  await f.call('/api/admin/whatsapp', { ...auth, body: { currentPassword: PASSWORD, ...credentials, enabled: false } });
  const before = f.app.store.db.prepare('SELECT ciphertext FROM owner_whatsapp_config').get().ciphertext;
  for (const invalid of [{ phoneNumberId: 'x' }, { graphVersion: 'https://attacker.test' }, { enabled: 'true' }]) {
    result = await f.call('/api/admin/whatsapp', { ...auth, body: { currentPassword: PASSWORD, ...invalid } });
    assert.equal(result.status, 400);
    assert.deepEqual(f.app.store.db.prepare('SELECT ciphertext FROM owner_whatsapp_config').get().ciphertext, before);
  }
});

test('missing encryption key permits read-only safe status but cannot save credentials', async (t) => {
  const f = await fixture(t, { whatsappConfigKey: '' });
  const owner = await f.setup();
  const auth = { cookie: owner.cookie, csrf: owner.data.csrfToken };
  assert.equal((await f.call('/api/admin/whatsapp', auth)).data.storageAvailable, false);
  const result = await f.call('/api/admin/whatsapp', { ...auth, method: 'PATCH', body: { currentPassword: PASSWORD, ...credentials } });
  assert.equal(result.status, 503);
  assert.equal(result.data.error.code, 'whatsapp_storage_unavailable');
});

test('portal encryption survives restart; wrong key or tampering fails closed without environment fallback', () => {
  const store = createStore({ dataDir: ':memory:', business });
  try {
    const config = { origin: 'http://owner.test', whatsappConfigKey: randomBytes(32).toString('base64'), whatsapp: { ...credentials } };
    const settings = createWhatsappSettings({ store, config });
    assert.equal(settings.getStatus().source, 'environment');
    assert.equal(settings.getStatus().enabled, true);
    const incompleteEnvironment = createWhatsappSettings({ store, config: { ...config, whatsapp: { ...credentials, appSecret: '' } } });
    assert.equal(incompleteEnvironment.getStatus().configured, true);
    assert.equal(incompleteEnvironment.getStatus().webhookConfigured, false);
    assert.equal(incompleteEnvironment.getStatus().enabled, false);
    assert.equal(incompleteEnvironment.getWhatsappConfig().enabled, false);
    settings.update({ ...credentials, enabled: false });
    const restarted = createWhatsappSettings({ store, config });
    assert.equal(restarted.getStatus().source, 'portal');
    assert.equal(restarted.getWhatsappConfig().accessToken, credentials.accessToken);
    assert.equal(restarted.getStatus().enabled, false);
    const wrongKey = createWhatsappSettings({ store, config: { ...config, whatsappConfigKey: randomBytes(32).toString('base64') } });
    assert.equal(wrongKey.getStatus().storageAvailable, false);
    assert.equal(wrongKey.getStatus().source, 'portal');
    assert.equal(wrongKey.getStatus().enabled, false);
    assert.equal(wrongKey.getStatus().configured, false);
    const missingKey = createWhatsappSettings({ store, config: { ...config, whatsappConfigKey: '' } });
    assert.equal(missingKey.getStatus().source, 'portal');
    assert.equal(missingKey.getStatus().enabled, false);
    store.db.prepare('UPDATE owner_whatsapp_config SET auth_tag = ?').run(randomBytes(16));
    assert.equal(restarted.getStatus().storageAvailable, false);
    assert.equal(restarted.getStatus().enabled, false);
    assert.throws(() => restarted.update({ enabled: false }), (error) => error.code === 'whatsapp_storage_unavailable');
  } finally { store.close(); }
});

test('dynamic runner pauses immediately and reads webhook credentials without restart; sends stay mocked', async (t) => {
  let instant = localDateTimeToEpoch('2026-10-04', '17:30');
  const store = createStore({ dataDir: ':memory:', business, now: () => instant });
  const config = { origin: 'http://owner.test', whatsapp: {}, whatsappConfigKey: randomBytes(32).toString('base64') };
  const settings = createWhatsappSettings({ store, config, now: () => instant });
  let calls = 0;
  const runner = createReminderRunner({ store, config, getWhatsappConfig: settings.getWhatsappConfig, now: () => instant,
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ messages: [{ id: `wamid.mock-${calls}` }] })); },
  });
  t.after(async () => { await runner.stop(); store.close(); });
  store.createAdminAppointment({ title: 'Taglio', date: '2026-10-05', time: '10:00', durationMinutes: 30, name: 'Ada', phone: '+393500000001', reminderConsent: true }, instant);
  settings.update({ ...credentials, enabled: false });
  instant = localDateTimeToEpoch('2026-10-04', '18:01');
  assert.equal(runner.getStatus().configured, true);
  assert.equal(runner.getStatus().enabled, false);
  assert.equal((await runner.tick()).processed, 0);
  assert.equal(calls, 0);
  settings.update({ enabled: true });
  assert.equal(runner.getStatus().enabled, true);
  assert.equal((await runner.tick()).processed, 1);
  assert.equal(calls, 1);
  settings.update({ enabled: false, verifyToken: 'rotated-verification-only-a-fixture', appSecret: 'rotated-application-only-a-fixture' });
  const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': credentials.verifyToken, 'hub.challenge': '123456' });
  assert.equal(runner.handleWebhook({ method: 'GET', query }).status, 403);
  query.set('hub.verify_token', 'rotated-verification-only-a-fixture');
  assert.equal(runner.handleWebhook({ method: 'GET', query }).status, 200);
  const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
  const signature = `sha256=${createHmac('sha256', 'rotated-application-only-a-fixture').update(rawBody).digest('hex')}`;
  assert.equal(runner.handleWebhook({ method: 'POST', rawBody, signature }).status, 200);
  assert.equal(calls, 1);
});

test('account email rotation verifies current password and revokes all old sessions', async (t) => {
  const f = await fixture(t);
  const first = await f.setup();
  const second = await f.call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD } });
  const auth = { cookie: first.cookie, csrf: first.data.csrfToken, method: 'PATCH' };
  const wrong = await f.call('/api/admin/account', { ...auth, body: { email: 'new@example.test', currentPassword: 'wrong' } });
  assert.equal(wrong.status, 400);
  assert.equal((await f.call('/api/auth/session', { cookie: first.cookie })).data.authenticated, true);
  const changed = await f.call('/api/admin/account', { ...auth, body: { email: '  NEW@example.test  ', currentPassword: PASSWORD } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.email, 'new@example.test');
  assert.notEqual(changed.cookie, first.cookie);
  assert.notEqual(changed.data.csrfToken, first.data.csrfToken);
  for (const cookie of [first.cookie, second.cookie]) assert.equal((await f.call('/api/admin/settings', { cookie })).status, 401);
  assert.equal((await f.call('/api/admin/settings', { cookie: changed.cookie })).status, 200);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { email: business.email, password: PASSWORD } })).status, 401);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { email: 'new@example.test', password: PASSWORD } })).status, 200);
});

test('wrong current password during password change preserves the authenticated owner session', async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const originalHash = f.app.store.db.prepare('SELECT password_hash FROM owners WHERE id=1').get().password_hash;
  const wrong = await f.call('/api/admin/password', {
    method: 'POST', cookie: owner.cookie, csrf: owner.data.csrfToken,
    body: { currentPassword: 'wrong', password: 'Password nuova valida ma non autorizzata!' },
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error.code, 'invalid_current_password');
  assert.equal(wrong.cookie, undefined);
  const session = await f.call('/api/auth/session', { cookie: owner.cookie });
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.csrfToken, owner.data.csrfToken);
  assert.equal((await f.call('/api/admin/settings', { cookie: owner.cookie })).status, 200);
  assert.equal(f.app.store.db.prepare('SELECT password_hash FROM owners WHERE id=1').get().password_hash, originalHash);
});

test('private backup is password-protected standalone SQLite with no public copy or plaintext credentials', async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const auth = { cookie: owner.cookie, csrf: owner.data.csrfToken };
  await f.call('/api/admin/whatsapp', { ...auth, method: 'PATCH', body: { ...credentials, currentPassword: PASSWORD, enabled: false } });
  const wrong = await f.call('/api/admin/backup', { ...auth, method: 'POST', body: { currentPassword: 'wrong' } });
  assert.equal(wrong.status, 400);
  assert.equal((await f.call('/api/admin/backup', { ...auth, csrf: undefined, method: 'POST', body: { currentPassword: PASSWORD } })).status, 403);
  const snapshot = await f.call('/api/admin/backup', { ...auth, method: 'POST', body: { currentPassword: PASSWORD }, raw: true });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.response.headers.get('content-type'), 'application/vnd.sqlite3');
  assert.match(snapshot.response.headers.get('content-disposition'), /^attachment;/);
  assert.equal(snapshot.response.headers.get('cache-control'), 'no-store');
  assert.match(snapshot.response.headers.get('x-robots-tag'), /noindex/);
  assert.equal(snapshot.data.subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.equal(snapshot.data[18], 1);
  assert.equal(snapshot.data[19], 1);
  for (const name of ['accessToken', 'appSecret', 'verifyToken']) assert.equal(snapshot.data.includes(Buffer.from(credentials[name])), false);
  const file = join(f.directory, 'downloaded.sqlite');
  await writeFile(file, snapshot.data);
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(database.prepare('SELECT email FROM owners WHERE id=1').get().email, business.email);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM owner_whatsapp_config').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM services').get().count, 1);
    for (const suffix of ['-wal', '-shm', '-journal']) await assert.rejects(access(file + suffix), { code: 'ENOENT' });
  } finally { database.close(); }
  for (const suffix of ['-wal', '-shm', '-journal']) await assert.rejects(access(file + suffix), { code: 'ENOENT' });
  assert.equal((await f.call('/agenda-desideri-di-felicita.sqlite')).status, 404);
});

test('admin aliases always carry private headers and new catalog/customer APIs require owner access', async (t) => {
  const f = await fixture(t);
  for (const path of ['/admin', '/admin/', '/admin.html', '/admin/index.html', '/admin//', '/%61dmin', '/admin%2f']) {
    const result = await f.call(path);
    assert.equal(result.response.headers.get('cache-control'), 'no-store', path);
    assert.match(result.response.headers.get('x-robots-tag'), /noindex/, path);
  }
  assert.equal((await f.call('/api/admin/customers')).status, 401);
  assert.equal((await f.call('/api/admin/customers/history?phone=%2B393500000001')).status, 401);
  assert.equal((await f.call('/api/admin/services', { method: 'POST', body: { name: 'Piega' } })).status, 401);
  const owner = await f.setup();
  const auth = { cookie: owner.cookie, csrf: owner.data.csrfToken };
  const service = await f.call('/api/admin/services', { ...auth, method: 'POST', body: { name: 'Piega', durationMinutes: null, enabled: false, listed: true } });
  assert.equal(service.status, 201);
  assert.equal(service.data.durationMinutes, null);
  assert.equal(service.data.listed, true);
  assert.deepEqual((await f.call('/api/admin/customers', auth)).data.items, []);
  assert.equal((await f.call('/api/admin/customers?limit=201', auth)).status, 400);
  assert.equal((await f.call('/api/admin/customers?q=' + 'a'.repeat(101), auth)).status, 400);
  assert.deepEqual((await f.call('/api/admin/customers/history?phone=%2B393500000001', auth)).data, { appointments: [], requests: [] });
  assert.equal((await f.call('/api/admin/customers/history?phone=invalid', auth)).status, 400);
  assert.equal((await f.call('/api/admin/customers/history?phone=%2B393500000001&limit=101', auth)).status, 400);
  f.app.store.createAdminAppointment({ title: 'Piega', date: '2026-10-05', time: '10:00', durationMinutes: 30, name: 'Ada', phone: '+393500000001', reminderConsent: false }, localDateTimeToEpoch('2026-10-04', '17:30'));
  const history = await f.call('/api/admin/customers/history?phone=%2B393500000001', auth);
  assert.equal(history.data.appointments.length, 1);
  assert.equal(history.data.appointments[0].name, 'Ada');
  assert.equal(history.response.headers.get('cache-control'), 'no-store');
});
