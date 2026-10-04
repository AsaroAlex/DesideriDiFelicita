import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/http.mjs';

const business = {
  businessName: 'Salone test', email: 'proprietaria@example.test',
  services: [{ name: 'Taglio' }, { name: 'Colore' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => ({ day, label: day, ranges: [{ opens: '09:00', closes: '18:00' }] })),
};
const PASSWORD = 'Password di prova molto sicura!';
const TOKEN = 'activation-for-http-request-tests-over-32-characters';
const NOW = Date.UTC(2026, 9, 4, 8);
const requestBody = (patch = {}) => ({ serviceId: 'taglio', date: '2026-10-05', time: '09:00', name: 'Anna Rossi', phone: '+393500123456', reminderConsent: true, clientRequestId: randomUUID(), ...patch });

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'salon-requests-http-'));
  const staticDir = join(directory, 'dist');
  await mkdir(staticDir, { recursive: true });
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Salone</title>');
  const config = {
    origin: 'http://booking.test', host: '127.0.0.1', port: 0,
    dataDir: join(directory, 'data'), staticDir, business,
    bootstrapToken: TOKEN, bootstrapExpiresAt: new Date(NOW + 3_600_000).toISOString(), whatsapp: {}, ...overrides,
  };
  // No reminder poller or real provider is used in integration tests.
  const runner = { start() {}, stop() {}, getStatus: () => ({ configured: false, missing: [], dailyLimit: 20, monthlyLimit: 200, sentThisMonth: 0 }) };
  const app = createApp({ config, reminderRunner: runner, now: () => NOW });
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function call(path, { method = 'GET', body, owner, origin = config.origin, csrf = owner?.data.csrfToken, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(method !== 'GET' ? { Origin: origin } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(owner ? { Cookie: owner.cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const data = await response.json();
    return { status: response.status, response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const setup = () => call('/api/auth/setup', { method: 'POST', body: { token: TOKEN, password: PASSWORD } });
  const submit = (body = requestBody(), options = {}) => call('/api/public/requests', { method: 'POST', body, ...options });
  return { app, call, setup, submit };
}

test('a fresh unconfigured salon offers a real calendar and stores requests without claiming confirmation', async (t) => {
  const { app, call, submit } = await fixture(t);
  const config = await call('/api/public/config');
  assert.equal(config.status, 200);
  assert.equal(config.data.bookingEnabled, false);
  assert.deepEqual(config.data.services, []);
  assert.equal(config.data.requestEnabled, true);
  assert.equal(config.data.requestServices.length, 2);
  assert.ok(config.data.requestServices.every((service) => service.durationMinutes === null && service.instantBooking === false));
  const availability = await call('/api/public/request-availability?serviceId=taglio&date=2026-10-05');
  assert.equal(availability.status, 200);
  assert.equal(availability.data.mode, 'request');
  assert.equal(availability.data.slots[0].time, '09:00');
  assert.ok(availability.data.slots.every((slot) => slot.endsAt === null));
  const submitted = await submit();
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.status, 'pending');
  assert.match(submitted.data.reference, /^DR-/);
  assert.equal(submitted.data.serviceName, 'Taglio');
  assert.equal(submitted.data.date, '2026-10-05');
  for (const privateField of ['name', 'phone', 'reminderConsent', 'clientRequestId', 'payloadHash']) assert.equal(Object.hasOwn(submitted.data, privateField), false);
  assert.equal(app.store.listRequests()[0].name, 'Anna Rossi');
  assert.equal(app.store.listAppointments().length, 0);
  assert.equal(app.store.listReminders().length, 0);
  assert.equal((await call('/api/admin/requests')).status, 401);
  assert.equal((await call(`/api/public/requests/${submitted.data.id}`)).status, 404);
  assert.equal(submitted.response.headers.get('cache-control'), 'no-store');
});

test('request submissions preserve Origin, JSON and body-size protections', async (t) => {
  const { submit, app } = await fixture(t);
  assert.equal((await submit(requestBody(), { origin: 'https://evil.test' })).status, 403);
  assert.equal((await submit(requestBody(), { headers: { Origin: '' } })).status, 403);
  assert.equal((await submit(requestBody(), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await submit('{}', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await submit('[')).status, 400);
  assert.equal((await submit(requestBody({ name: 'a'.repeat(33 * 1024) }))).status, 413);
  assert.equal((await submit(requestBody({ clientRequestId: 'unsafe-key' }))).status, 400);
  assert.equal(app.store.listRequests().length, 0);
});

test('identical retries return one private persisted request, while changed reuse is rejected', async (t) => {
  const { app, call, setup, submit } = await fixture(t);
  const body = requestBody();
  const first = await submit(body);
  const retry = await submit({ ...body, name: ' Anna   Rossi ', phone: '00 39 350 012 3456' });
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.data, first.data);
  assert.equal(app.store.listRequests().length, 1);
  assert.equal((await submit({ ...body, time: '09:15' })).status, 409);
  const owner = await setup();
  assert.equal(owner.status, 201);
  const approved = await call(`/api/admin/requests/${first.data.id}/confirm`, { method: 'POST', owner, body: { durationMinutes: 45 } });
  assert.equal(approved.status, 201);
  const afterConfirmation = await submit(body);
  assert.equal(afterConfirmation.status, 201);
  assert.equal(afterConfirmation.data.status, 'confirmed');
  assert.equal(afterConfirmation.data.reference, first.data.reference);
  assert.equal(Object.hasOwn(afterConfirmation.data, 'phone'), false);
});

test('the owner privately confirms a request once, with explicit duration and CSRF protection', async (t) => {
  const { app, call, setup, submit } = await fixture(t);
  const requested = await submit();
  const id = requested.data.id;
  const confirmPath = `/api/admin/requests/${id}/confirm`;
  assert.equal((await call(confirmPath, { method: 'POST', body: { durationMinutes: 45 } })).status, 401);
  const owner = await setup();
  const listing = await call('/api/admin/requests', { owner });
  assert.equal(listing.status, 200);
  assert.equal(listing.data.items[0].phone, '+393500123456');
  assert.equal(listing.response.headers.get('cache-control'), 'no-store');
  assert.equal((await call('/api/admin/stats', { owner })).data.pendingRequests, 1);
  assert.equal((await call(confirmPath, { method: 'POST', owner, csrf: '', body: { durationMinutes: 45 } })).status, 403);
  assert.equal((await call(confirmPath, { method: 'POST', owner, origin: 'https://evil.test', body: { durationMinutes: 45 } })).status, 403);
  assert.equal((await call(confirmPath, { method: 'POST', owner, body: {} })).status, 400);
  const confirmed = await call(confirmPath, { method: 'POST', owner, body: { durationMinutes: 45 } });
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.data.request.status, 'confirmed');
  assert.equal(confirmed.data.appointment.durationMinutes, 45);
  assert.equal(confirmed.data.appointment.reminderConsent, true);
  const retry = await call(confirmPath, { method: 'POST', owner, body: { durationMinutes: 45 } });
  assert.equal(retry.status, 201);
  assert.equal(retry.data.appointment.id, confirmed.data.appointment.id);
  assert.equal(app.store.listAppointments().length, 1);
  assert.equal(app.store.listReminders().length, 1);
  assert.equal((await call('/api/admin/requests', { owner })).data.items.length, 0);
  assert.equal((await call('/api/admin/requests?status=confirmed', { owner })).data.items.length, 1);
  assert.equal((await call('/api/admin/stats', { owner })).data.pendingRequests, 0);
  assert.equal((await call(`/api/admin/requests/${id}/decline`, { method: 'POST', owner, body: {} })).status, 409);
});

test('a confirmation conflict leaves the request pending and declining is guarded and idempotent', async (t) => {
  const { app, call, setup, submit } = await fixture(t);
  const requested = await submit(requestBody({ reminderConsent: false }));
  const owner = await setup();
  const appointment = await call('/api/admin/appointments', { method: 'POST', owner, body: { serviceId: 'taglio', date: '2026-10-05', time: '09:00', durationMinutes: 45, name: 'Altra cliente', phone: '+393500123457', reminderConsent: false } });
  assert.equal(appointment.status, 201);
  const conflict = await call(`/api/admin/requests/${requested.data.id}/confirm`, { method: 'POST', owner, body: { durationMinutes: 45 } });
  assert.equal(conflict.status, 409);
  assert.equal(app.store.listRequests()[0].status, 'pending');
  assert.equal(app.store.listAppointments().length, 1);
  assert.equal(app.store.listReminders().length, 0);
  const path = `/api/admin/requests/${requested.data.id}/decline`;
  assert.equal((await call(path, { method: 'POST', owner, csrf: '', body: {} })).status, 403);
  assert.equal((await call(path, { method: 'POST', owner, body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const declined = await call(path, { method: 'POST', owner, body: {} });
  assert.equal(declined.status, 200);
  assert.equal(declined.data.status, 'declined');
  assert.deepEqual((await call(path, { method: 'POST', owner, body: {} })).data, declined.data);
  assert.equal((await call('/api/admin/requests?status=declined', { owner })).data.items.length, 1);
  assert.equal((await call('/api/admin/requests?status=all', { owner })).status, 400);
  assert.equal((await call('/api/admin/requests?limit=501', { owner })).status, 400);
  assert.equal((await call('/api/admin/requests?limit=1e2', { owner })).status, 400);
});

test('requests and instant bookings share the per-IP hourly rate budget', async (t) => {
  const { call } = await fixture(t);
  for (let index = 0; index < 10; index++) {
    const path = index % 2 ? '/api/public/bookings' : '/api/public/requests';
    assert.notEqual((await call(path, { method: 'POST', body: {} })).status, 429);
  }
  for (const path of ['/api/public/bookings', '/api/public/requests']) {
    const rejected = await call(path, { method: 'POST', body: {} });
    assert.equal(rejected.status, 429);
    assert.ok(Number(rejected.response.headers.get('retry-after')) > 0);
  }
});

test('requests and instant bookings also share the global hourly limit across client IPs', async (t) => {
  const { call } = await fixture(t, { trustProxy: 'railway' });
  for (let index = 0; index < 60; index++) {
    const ip = `198.51.100.${Math.floor(index / 10) + 1}`;
    const path = index % 2 ? '/api/public/bookings' : '/api/public/requests';
    assert.notEqual((await call(path, { method: 'POST', body: {}, headers: { 'x-real-ip': ip } })).status, 429);
  }
  const rejected = await call('/api/public/requests', { method: 'POST', body: {}, headers: { 'x-real-ip': '198.51.100.100' } });
  assert.equal(rejected.status, 429);
});

test('pausing requests preserves configured instant booking and masks unconfigured calendar preferences', async (t) => {
  const { app, call, setup, submit } = await fixture(t);
  app.store.updateService('taglio', { durationMinutes: 45, enabled: true }, NOW);
  const owner = await setup();
  const changed = await call('/api/admin/settings', { method: 'PATCH', owner, body: { requestEnabled: false, bookingEnabled: true } });
  assert.equal(changed.status, 200);
  const config = await call('/api/public/config');
  assert.equal(config.data.requestEnabled, false);
  assert.equal(config.data.bookingEnabled, true);
  assert.deepEqual(config.data.requestServices, []);
  assert.equal(config.data.services[0].name, 'Taglio');
  assert.notEqual((await call('/api/public/request-availability?serviceId=taglio&date=2026-10-05')).status, 200);
  assert.notEqual((await submit()).status, 201);
  const confirmed = await call('/api/public/bookings', { method: 'POST', body: requestBody() });
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.data.status, 'confirmed');
});
