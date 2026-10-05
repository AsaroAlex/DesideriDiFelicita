import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { createStore } from '../server/db.mjs';
import { createApp } from '../server/http.mjs';
import { createCustomerAccess } from '../server/customer-access.mjs';
import { localDateTimeToEpoch } from '../server/time.mjs';

const epoch = localDateTimeToEpoch;
const business = { businessName: 'Salone test', email: 'owner@example.test',
  address: { street: 'Via di prova 1', city: 'Bologna', postalCode: '40100', country: 'Italia' },
  services: [{ id: 'taglio', name: 'Taglio', description: 'Taglio del salone, senza prezzi inventati.' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map((day) => ({ day, label: day, ranges: [{ opens: '09:00', closes: '18:00' }] })),
};
const body = (patch = {}) => ({ serviceId: 'taglio', date: '2026-10-06', time: '09:00', name: 'Cliente fixture', phone: '+393500000001', reminderConsent: true, ...patch });

function storeFixture(t) {
  let instant = epoch('2026-10-05', '08:00');
  const store = createStore({ dataDir: ':memory:', business, now: () => instant });
  t.after(() => store.close());
  const config = { whatsappConfigKey: randomBytes(32).toString('base64') };
  const access = createCustomerAccess({ store, config, now: () => instant });
  return { store, access, config, now: () => instant, setNow: (value) => { instant = value; } };
}

test('catalog descriptions and optional owner prices migrate without inventing price or treatment duration', (t) => {
  const { store } = storeFixture(t);
  const fresh = store.getPublicConfig();
  assert.equal(fresh.catalog[0].description, business.services[0].description);
  assert.equal(fresh.catalog[0].durationMinutes, null);
  assert.equal(fresh.catalog[0].priceCents, null);
  assert.equal(fresh.catalog[0].listed, true);
  assert.equal(fresh.catalog[0].bufferAfterMinutes, 0);
  const saved = store.updateService('taglio', { description: 'Descrizione owner', priceCents: 3500, priceFrom: true, bufferAfterMinutes: 15 });
  assert.equal(saved.priceCents, 3500);
  assert.equal(saved.priceFrom, true);
  assert.equal(store.getPublicConfig().requestServices[0].description, 'Descrizione owner');
  assert.throws(() => store.updateService('taglio', { priceCents: 3.5 }), (error) => error.status === 400);
  assert.throws(() => store.updateService('taglio', { bufferAfterMinutes: 121 }), (error) => error.status === 400);
  assert.equal(store.listServices()[0].priceCents, 3500);
  store.updateService('taglio', { listed: false });
  assert.deepEqual(store.getPublicConfig().catalog, []);
});

test('lead, treatment buffers and real blocks govern single/bulk slots and atomic booking conflicts', (t) => {
  const f = storeFixture(t);
  f.store.updateService('taglio', { durationMinutes: 30, enabled: true, bufferAfterMinutes: 15 });
  f.store.updateSettings({ bookingEnabled: true, bookingLeadMinutes: 90 });
  f.store.createBlock({ title: 'Pausa privata', date: '2026-10-05', time: '11:00', durationMinutes: 45 });
  const single = f.store.getAvailability({ serviceId: 'taglio', date: '2026-10-05' }).slots;
  const bulk = f.store.getAvailabilityRange({ serviceId: 'taglio', from: '2026-10-05', days: 1 }).days[0].slots;
  assert.deepEqual(single, bulk);
  assert.equal(single[0].time, '09:30');
  assert.equal(single.some((slot) => slot.time === '10:30'), false);
  assert.equal(single.some((slot) => slot.time === '10:15'), true);
  assert.equal(single.at(-1).time, '17:15');
  assert.throws(() => f.store.createPublicBooking(body({ date: '2026-10-05', time: '09:00' })), (error) => error.code === 'slot_unavailable');
  const booking = f.store.createPublicBooking(body({ date: '2026-10-05', time: '09:30' }));
  assert.equal(f.store.listAppointments({ from: '2026-10-05', to: '2026-10-05' })[0].bufferAfterMinutes, 15);
  assert.throws(() => f.store.createAdminAppointment({ ...body({ date: '2026-10-05', time: '10:00' }), durationMinutes: 5 }), (error) => error.code === 'slot_conflict');
  assert.throws(() => f.store.createBlock({ title: 'Sovrapposta', date: '2026-10-05', time: '10:00', durationMinutes: 10 }), (error) => error.code === 'slot_conflict');
  f.store.updateService('taglio', { bufferAfterMinutes: 60, durationMinutes: 90 });
  const existing = f.store.listAppointments({ from: '2026-10-05', to: '2026-10-05' }).find((item) => item.id === booking.id);
  assert.equal(existing.durationMinutes, 30);
  assert.equal(existing.bufferAfterMinutes, 15);
  f.store.updateSettings({ bookingDays: 1 });
  assert.equal(f.store.getAvailabilityRange({ serviceId: 'taglio', from: '2026-10-05', days: 14 }).days.length, 2);
});

test('blocks and appointments crossing midnight intersect the loaded day, and block deletion is idempotent', (t) => {
  const f = storeFixture(t);
  const block = f.store.createBlock({ title: 'Pausa notte', date: '2026-10-05', time: '23:30', durationMinutes: 60 });
  assert.equal(f.store.listBlocks({ from: '2026-10-06', to: '2026-10-06' }).length, 1);
  assert.deepEqual(f.store.deleteBlock(block.id), { ok: true });
  assert.deepEqual(f.store.deleteBlock(block.id), { ok: true });
  const appointment = f.store.createAdminAppointment({ ...body({ date: '2026-10-05', time: '23:30' }), durationMinutes: 60 });
  assert.equal(f.store.listAppointments({ from: '2026-10-06', to: '2026-10-06' })[0].id, appointment.id);
  assert.throws(() => f.store.listBlocks({ from: '2026-01-01', to: '2027-01-03' }), (error) => error.code === 'invalid_range');
});

test('private notes use CAS and appointment outcomes preserve reminders revision and public privacy', (t) => {
  const f = storeFixture(t);
  const appointment = f.store.createAdminAppointment({ ...body({ date: '2026-10-05' }), notes: 'Nota iniziale', durationMinutes: 30 });
  assert.throws(() => f.store.updateAppointment(appointment.id, { outcome: 'completed' }, f.now()), (error) => error.code === 'invalid_outcome');
  const profile = f.store.getCustomerProfile('+39 350 000 0001');
  assert.equal(profile.version, 0);
  const changed = f.store.updateCustomerProfile({ phone: profile.phone, notes: 'Nota CRM privata', version: 0 }, f.now());
  assert.equal(changed.version, 1);
  assert.throws(() => f.store.updateCustomerProfile({ phone: profile.phone, notes: 'Bozza concorrente', version: 0 }), (error) => error.code === 'profile_changed');
  assert.equal(f.store.getCustomerProfile(profile.phone).notes, 'Nota CRM privata');
  assert.throws(() => f.store.getCustomerProfile('+393500000099'), (error) => error.status === 404);
  f.setNow(epoch('2026-10-05', '10:00'));
  const completed = f.store.updateAppointment(appointment.id, { outcome: 'completed', notes: 'Appunto owner' }, f.now());
  assert.equal(completed.revision, appointment.revision);
  assert.equal(completed.outcome, 'completed');
  const path = f.access.issue('appointment', appointment.id).managementPath;
  const view = f.access.getView(path.split('=')[1]);
  assert.equal(view.canCancel, false);
  assert.equal(view.canDownloadCalendar, false);
  assert.equal(Object.hasOwn(view, 'notes'), false);
  assert.equal(JSON.stringify(f.store.getPublicConfig()).includes('Nota CRM'), false);
});

test('request notes are bounded, transferred on confirmation, and old no-notes payload hashes keep idempotence', (t) => {
  const f = storeFixture(t);
  const input = body({ clientRequestId: randomUUID(), notes: 'Preferenza cliente' });
  const request = f.store.createPublicRequest(input);
  assert.equal(f.store.listRequests()[0].notes, 'Preferenza cliente');
  assert.equal(f.store.confirmRequest(request.id, { durationMinutes: 45 }, f.now()).appointment.notes, 'Preferenza cliente');
  assert.throws(() => f.store.createPublicRequest({ ...input, notes: 'Diversa' }), (error) => error.code === 'request_id_reused');
  assert.throws(() => f.store.createPublicRequest(body({ clientRequestId: randomUUID(), notes: 'x'.repeat(501) })), (error) => error.code === 'invalid_notes');
  const oldInput = body({ time: '11:00', clientRequestId: randomUUID() });
  const old = f.store.createPublicRequest(oldInput);
  const legacyHash = createHash('sha256').update(JSON.stringify({ serviceId: oldInput.serviceId, date: oldInput.date, time: oldInput.time, name: oldInput.name, phone: oldInput.phone, reminderConsent: oldInput.reminderConsent })).digest('hex');
  f.store.db.prepare('UPDATE booking_requests SET payload_hash=? WHERE id=?').run(legacyHash, old.id);
  assert.equal(f.store.createPublicRequest(oldInput).id, old.id);
});

test('direct booking UUID retries preserve one actual appointment after cancellation and reject changed payload', (t) => {
  const f = storeFixture(t);
  f.store.updateService('taglio', { durationMinutes: 30, enabled: true });
  f.store.updateSettings({ bookingEnabled: true });
  const input = body({ clientRequestId: randomUUID(), notes: 'Preferenza cliente' });
  const first = f.store.createPublicBooking(input);
  assert.deepEqual(f.store.createPublicBooking(input), first);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM appointments').get().count, 1);
  assert.throws(() => f.store.createPublicBooking({ ...input, notes: 'Modificata' }), (error) => error.code === 'request_id_reused');
  f.store.updateAppointment(first.id, { status: 'cancelled' }, f.now());
  assert.equal(f.store.createPublicBooking(input).status, 'cancelled');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM appointments').get().count, 1);
});

test('confirmed request retries report the saved appointment duration after catalog edits and cancellation', (t) => {
  const f = storeFixture(t);
  const input = body({ clientRequestId: randomUUID() });
  const request = f.store.createPublicRequest(input);
  assert.equal(Object.hasOwn(request, 'durationMinutes'), false);
  const confirmed = f.store.confirmRequest(request.id, { durationMinutes: 45 }, f.now());
  f.store.updateService('taglio', { durationMinutes: 90 });
  const receipt = f.store.createPublicRequest(input);
  assert.equal(receipt.reference, request.reference);
  assert.equal(receipt.status, 'confirmed');
  assert.equal(receipt.durationMinutes, 45);
  assert.equal(Object.hasOwn(receipt, 'notes'), false);
  f.store.updateAppointment(confirmed.appointment.id, { status: 'cancelled' }, f.now());
  const cancelled = f.store.createPublicRequest(input);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.durationMinutes, 45);
});

test('one request grant follows confirmation, deterministic receipt, owner link reuse and explicit rotation', (t) => {
  const f = storeFixture(t);
  const request = f.store.createPublicRequest(body({ clientRequestId: randomUUID() }));
  const initial = f.access.issue('request', request.id);
  assert.deepEqual(f.access.issue('request', request.id), initial);
  const token = initial.managementPath.split('=')[1];
  assert.equal(token.length, 43);
  const raw = f.store.db.prepare('SELECT * FROM customer_access').get();
  assert.equal(JSON.stringify(raw).includes(token), false);
  assert.equal(f.access.getView(token).kind, 'request');
  const confirmed = f.store.confirmRequest(request.id, { durationMinutes: 45 }, f.now());
  assert.equal(f.access.issue('appointment', confirmed.appointment.id).managementPath, initial.managementPath);
  assert.equal(f.access.issue('appointment', confirmed.appointment.id).expiresAt, confirmed.appointment.endsAt + 7 * 86_400_000);
  assert.equal(f.access.getView(token).kind, 'appointment');
  assert.equal(f.access.getView(token).durationMinutes, 45);
  assert.equal(f.access.getView(token).reference, request.reference);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM customer_access').get().count, 1);
  const rotated = f.access.issue('appointment', confirmed.appointment.id, { rotate: true });
  assert.notEqual(rotated.managementPath, initial.managementPath);
  assert.throws(() => f.access.getView(token), (error) => error.status === 404);
  assert.equal(f.access.getView(rotated.managementPath.split('=')[1]).status, 'confirmed');
});

test('customer edits preserve actual duration/buffer, slot guards, CAS, policy and idempotent mutation', (t) => {
  const f = storeFixture(t);
  f.store.updateService('taglio', { durationMinutes: 30, bufferAfterMinutes: 15 });
  const appointment = f.store.createAdminAppointment({ ...body(), durationMinutes: 30 });
  const token = f.access.issue('appointment', appointment.id).managementPath.split('=')[1];
  f.store.updateService('taglio', { durationMinutes: 120, bufferAfterMinutes: 60, listed: false });
  assert.equal(f.access.availability(token, { from: '2026-10-06', days: 1 }).days[0].slots.at(-1).time, '17:15');
  f.store.createBlock({ title: 'Pausa', date: '2026-10-06', time: '11:00', durationMinutes: 60 });
  assert.throws(() => f.access.reschedule(token, { date: '2026-10-06', time: '10:30', revision: 1 }), (error) => error.code === 'slot_unavailable');
  const moved = f.access.reschedule(token, { date: '2026-10-07', time: '12:00', revision: 1 });
  assert.equal(moved.durationMinutes, 30);
  assert.equal(moved.revision, 2);
  assert.equal(moved.managementExpiresAt, epoch('2026-10-07', '12:30') + 7 * 86_400_000);
  assert.deepEqual(f.access.reschedule(token, { date: '2026-10-07', time: '12:00', revision: 1 }), moved);
  assert.throws(() => f.access.cancel(token, { revision: 1 }), (error) => error.code === 'appointment_changed');
  f.store.updateSettings({ customerChangeNoticeHours: 168 });
  assert.equal(f.access.getView(token).canCancel, false);
  assert.throws(() => f.access.cancel(token, { revision: 2 }), (error) => error.code === 'customer_changes_unavailable');
  f.store.updateSettings({ customerChangeNoticeHours: 0 });
  const cancelled = f.access.cancel(token, { revision: 2 });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(f.access.cancel(token, { revision: 2 }), cancelled);
});

test('withdrawal stays additive, stops owner confirmation and cannot mutate a confirmed request', (t) => {
  const f = storeFixture(t);
  const request = f.store.createPublicRequest(body({ clientRequestId: randomUUID() }));
  const token = f.access.issue('request', request.id).managementPath.split('=')[1];
  const withdrawn = f.access.withdraw(token);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.deepEqual(f.access.withdraw(token), withdrawn);
  assert.equal(f.store.listRequests({ status: 'declined' })[0].withdrawnAt, f.now());
  assert.throws(() => f.store.confirmRequest(request.id, { durationMinutes: 30 }), (error) => error.code === 'request_not_pending');
  assert.equal(f.store.getStats().pendingRequests, 0);
  const another = f.store.createPublicRequest(body({ time: '12:00', clientRequestId: randomUUID() }));
  const confirmedToken = f.access.issue('request', another.id).managementPath.split('=')[1];
  f.store.confirmRequest(another.id, { durationMinutes: 30 });
  assert.throws(() => f.access.withdraw(confirmedToken), (error) => error.code === 'request_not_pending');
});

test('master-key changes, revocation and expiry fail closed while a missing key preserves old creation flows', (t) => {
  const f = storeFixture(t);
  const appointment = f.store.createAdminAppointment({ ...body(), durationMinutes: 30 });
  const issued = f.access.issue('appointment', appointment.id);
  const token = issued.managementPath.split('=')[1];
  const changedKey = createCustomerAccess({ store: f.store, config: { whatsappConfigKey: randomBytes(32).toString('base64') }, now: f.now });
  assert.throws(() => changedKey.getView(token), (error) => error.status === 404);
  assert.throws(() => changedKey.issue('appointment', appointment.id), (error) => error.code === 'customer_link_rotation_required');
  const newLink = changedKey.issue('appointment', appointment.id, { rotate: true });
  const nextToken = newLink.managementPath.split('=')[1];
  assert.equal(changedKey.getView(nextToken).status, 'confirmed');
  f.store.db.prepare('UPDATE customer_access SET revoked_at=?').run(f.now());
  assert.throws(() => changedKey.getView(nextToken), (error) => error.status === 404);
  const reset = changedKey.issue('appointment', appointment.id, { rotate: true });
  f.setNow(reset.expiresAt);
  assert.throws(() => changedKey.getView(reset.managementPath.split('=')[1]), (error) => error.status === 404);
  const missing = createCustomerAccess({ store: f.store, config: {}, now: f.now });
  assert.equal(missing.issue('appointment', appointment.id, { optional: true }).managementPath, null);
  assert.throws(() => missing.getView(token), (error) => error.status === 404);
});

test('reassigning the contact revokes direct and linked grants and original retries never regain the new contact link', (t) => {
  const f = storeFixture(t);
  for (const [index, kind] of ['appointment', 'request'].entries()) {
    let appointment;
    let originId;
    if (kind === 'appointment') { appointment = f.store.createAdminAppointment({ ...body({ time: '09:00' }), durationMinutes: 30 }); originId = appointment.id; }
    else {
      const request = f.store.createPublicRequest(body({ clientRequestId: randomUUID(), time: '11:00' })); originId = request.id;
      appointment = f.store.confirmRequest(request.id, { durationMinutes: 30 }).appointment;
    }
    const issued = f.access.issue(kind, originId);
    const oldToken = issued.managementPath.split('=')[1];
    f.store.updateAppointment(appointment.id, { phone: '+39 350 000 0001' });
    assert.equal(f.access.getView(oldToken).status, 'confirmed');
    const nextPhone = `+39350000001${index}`;
    f.store.updateAppointment(appointment.id, { name: 'Altra cliente fixture', phone: nextPhone });
    assert.throws(() => f.access.getView(oldToken), (error) => error.status === 404);
    assert.equal(f.access.issue(kind, originId, { optional: true, recipientPhone: '+393500000001' }).managementPath, null);
    const rotated = f.access.issue('appointment', appointment.id, { rotate: true });
    assert.equal(f.access.getView(rotated.managementPath.split('=')[1]).status, 'confirmed');
    assert.equal(f.access.issue(kind, originId, { optional: true, recipientPhone: '+393500000001' }).managementPath, null);
    assert.equal(f.access.issue(kind, originId, { optional: true, recipientPhone: nextPhone }).managementPath, rotated.managementPath);
  }
});

test('customer HTTP access requires Bearer, hides notes/contacts, returns ICS and does not use owner cookies', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'customer-http-feature-'));
  const instant = epoch('2026-10-05', '08:00');
  const bootstrapToken = 'customer-feature-bootstrap-fixture-at-least-32-characters';
  const config = { origin: 'http://customer.test', port: 0, host: '127.0.0.1', business, dataDir: directory, whatsapp: {}, whatsappConfigKey: randomBytes(32).toString('base64'), bootstrapToken, bootstrapExpiresAt: new Date(instant + 3_600_000).toISOString() };
  const app = createApp({ config, now: () => instant });
  const address = await app.start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  app.store.updateService('taglio', { durationMinutes: 30, enabled: true });
  app.store.updateSettings({ bookingEnabled: true });
  const input = body({ clientRequestId: randomUUID(), notes: 'Nota segreta cliente' });
  async function call(path, { method = 'GET', value, token, cookie, csrf, origin = config.origin } = {}) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method,
      headers: { ...(method === 'GET' ? {} : { Origin: origin }), ...(value ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: value ? JSON.stringify(value) : undefined });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, response, data };
  }
  const receipt = await call('/api/public/bookings', { method: 'POST', value: input });
  assert.equal(receipt.status, 201);
  assert.deepEqual((await call('/api/public/bookings', { method: 'POST', value: input })).data, receipt.data);
  let token = receipt.data.managementPath.split('=')[1];
  assert.equal((await call('/api/public/customer/appointment?token=' + token)).status, 404);
  const view = await call('/api/public/customer/appointment', { token });
  assert.equal(view.status, 200);
  for (const field of ['name', 'phone', 'notes']) assert.equal(Object.hasOwn(view.data, field), false);
  assert.equal(view.response.headers.get('cache-control'), 'no-store');
  assert.equal(view.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(view.response.headers.get('set-cookie'), null);
  const calendar = await call('/api/public/customer/calendar.ics', { token });
  assert.equal(calendar.status, 200);
  assert.match(calendar.response.headers.get('content-type'), /^text\/calendar/);
  for (const privateText of [token, input.name, input.phone, input.notes]) assert.equal(calendar.data.includes(privateText), false);
  const owner = await call('/api/auth/setup', { method: 'POST', value: { token: bootstrapToken, password: 'Password fixture cliente sicura2026!' } });
  let observer;
  const arrived = new Promise((resolveArrived) => {
    observer = (request) => { if (request.url === '/api/public/customer/cancel') { app.server.off('request', observer); resolveArrived(); } };
    app.server.on('request', observer);
  });
  let incompleteRequest;
  const delayedCancel = new Promise((resolveCancel, reject) => {
    incompleteRequest = httpRequest(`http://127.0.0.1:${address.port}/api/public/customer/cancel`, { method: 'POST', headers: {
      Origin: config.origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked',
    } }, (response) => { response.resume(); response.on('end', () => resolveCancel(response.statusCode)); });
    incompleteRequest.on('error', reject);
    incompleteRequest.write('{"revision":');
  });
  await arrived;
  const rotated = await call(`/api/admin/appointments/${receipt.data.id}/customer-link`, {
    method: 'POST', value: { rotate: true }, cookie: owner.response.headers.get('set-cookie').split(';')[0], csrf: owner.data.csrfToken,
  });
  assert.equal(rotated.status, 200);
  incompleteRequest.end('1}');
  assert.equal(await delayedCancel, 404);
  assert.equal(app.store.db.prepare('SELECT status FROM appointments WHERE id=?').get(receipt.data.id).status, 'confirmed');
  token = rotated.data.managementPath.split('=')[1];
  const cancel = { method: 'POST', token, value: { revision: 1 } };
  assert.equal((await call('/api/public/customer/cancel', { ...cancel, origin: 'https://other.test' })).status, 403);
  assert.equal((await call('/api/public/customer/cancel', cancel)).data.status, 'cancelled');
  assert.equal((await call('/api/public/customer/calendar.ics', { token })).status, 409);
  assert.equal(app.store.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event='whatsapp_send_claimed'").get().count, 0);
});
