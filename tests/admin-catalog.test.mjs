import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/db.mjs';
import { localDateTimeToEpoch } from '../server/time.mjs';

const business = {
  businessName: 'Desideri di Felicità',
  services: [{ name: 'Taglio donna' }, { name: 'Colore' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => ({
    day, label: day, ranges: ['Sunday', 'Monday'].includes(day) ? [] : [{ opens: '09:00', closes: '19:00' }],
  })),
};
const now = localDateTimeToEpoch('2026-10-05', '12:00');
const appointment = (patch = {}) => ({
  serviceId: 'taglio-donna', date: '2026-10-06', time: '09:00', durationMinutes: 30,
  name: 'Anna Rossi', phone: '+39 350 012 3456', reminderConsent: false, ...patch,
});
const request = (patch = {}) => ({ ...appointment(), clientRequestId: randomUUID(), ...patch });
function fixture(t) {
  const store = createStore({ dataDir: ':memory:', business, now: () => now });
  t.after(() => store.close());
  return store;
}

test('fresh and newly created services are visible requests without invented durations', (t) => {
  const store = fixture(t);
  assert.ok(store.listServices().every((service) => service.listed && !service.enabled && service.durationMinutes === null));
  const service = store.createService({ name: 'Consulenza ricci' });
  assert.equal(service.listed, true);
  assert.equal(service.enabled, false);
  assert.equal(service.durationMinutes, null);
  assert.deepEqual(store.getPublicConfig().requestServices.at(-1), {
    id: service.id, name: service.name, durationMinutes: null, instantBooking: false,
    description: '', priceCents: null, priceFrom: false, bufferAfterMinutes: 0, listed: true,
  });
  const saved = store.createPublicRequest(request({ serviceId: service.id }));
  assert.equal(saved.serviceName, 'Consulenza ricci');
  assert.equal(saved.status, 'pending');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM appointments').get().total, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM reminders').get().total, 0);
});

test('archive hides both public catalogs and blocks new submissions while owner history remains usable', (t) => {
  const store = fixture(t);
  store.updateService('colore', { durationMinutes: 60, enabled: true });
  const service = store.createService({ name: 'Trattamento', durationMinutes: 45, enabled: true });
  store.updateSettings({ bookingEnabled: true });
  const input = request({ serviceId: service.id });
  const pending = store.createPublicRequest(input);
  const archived = store.updateService(service.id, { listed: false, enabled: true });
  assert.equal(archived.listed, false);
  assert.equal(archived.enabled, false);
  assert.equal(archived.durationMinutes, 45);
  const config = store.getPublicConfig();
  assert.equal(config.bookingEnabled, true);
  assert.ok(!config.services.some((item) => item.id === service.id));
  assert.ok(!config.requestServices.some((item) => item.id === service.id));
  for (const action of [
    () => store.getRequestAvailability({ serviceId: service.id, date: input.date }),
    () => store.getAvailability({ serviceId: service.id, date: input.date }),
    () => store.createPublicRequest(request({ serviceId: service.id })),
    () => store.createPublicBooking(appointment({ serviceId: service.id })),
  ]) assert.throws(action, { code: 'invalid_service', status: 404 });
  assert.deepEqual(store.createPublicRequest(input), pending);
  assert.equal(store.listRequests()[0].serviceName, service.name);
  const confirmed = store.confirmRequest(pending.id);
  assert.equal(confirmed.appointment.serviceId, service.id);
  assert.equal(confirmed.appointment.durationMinutes, 45);
  assert.equal(store.listServices().find((item) => item.id === service.id).listed, false);
  assert.equal(store.listRequests({ status: 'confirmed' })[0].appointment.id, confirmed.appointment.id);
  assert.equal(store.updateAppointment(confirmed.appointment.id, { time: '11:00' }).time, '11:00');
  assert.equal(store.createPublicRequest(input).time, '11:00');
});

test('restoring a service keeps its ID and duration but requires deliberate reactivation of instant booking', (t) => {
  const store = fixture(t);
  store.updateService('taglio-donna', { durationMinutes: 45, enabled: true });
  store.updateSettings({ bookingEnabled: true });
  store.updateService('taglio-donna', { listed: false });
  assert.equal(store.getSettings().bookingEnabled, false);
  const restored = store.updateService('taglio-donna', { listed: true });
  assert.equal(restored.id, 'taglio-donna');
  assert.equal(restored.durationMinutes, 45);
  assert.equal(restored.enabled, false);
  assert.equal(store.getPublicConfig().requestServices.find((item) => item.id === restored.id).instantBooking, false);
  assert.equal(store.createPublicRequest(request()).status, 'pending');
  store.updateService(restored.id, { enabled: true });
  store.updateSettings({ bookingEnabled: true });
  assert.equal(store.getPublicConfig().services[0].id, restored.id);
});

test('catalog validates duplicate names, activation, fields and the 200-service limit without partial writes', (t) => {
  const store = fixture(t);
  const first = store.createService({ name: 'Cura Èlite', listed: false });
  const count = store.listServices().length;
  assert.throws(() => store.createService({ name: '  Cura   èlite  ' }), { code: 'duplicate_service', status: 409 });
  assert.throws(() => store.updateService('colore', { name: 'Cura èlite', durationMinutes: 30 }), { code: 'duplicate_service' });
  assert.equal(store.listServices().find((item) => item.id === 'colore').durationMinutes, null);
  assert.equal(store.updateService(first.id, { name: 'CURA ÈLITE' }).name, 'CURA ÈLITE');
  assert.throws(() => store.createService({ name: 'Senza durata', enabled: true }), { code: 'duration_required' });
  assert.throws(() => store.updateService('colore', { enabled: true }), { code: 'duration_required' });
  for (const invalid of [
    { name: '' }, { name: 'x'.repeat(101) }, { name: 'Nome\nnon valido' },
    { name: 'Altro', durationMinutes: 4 }, { name: 'Altro', durationMinutes: 481 },
    { name: 'Altro', enabled: 'false' }, { name: 'Altro', listed: 1 },
  ]) assert.throws(() => store.createService(invalid), { code: 'invalid_input' });
  assert.equal(store.listServices().length, count);
  for (let index = count; index < 200; index++) store.createService({ name: `Servizio ${index}`, listed: false });
  assert.throws(() => store.createService({ name: 'Oltre il limite' }), { code: 'service_limit', status: 409 });
  assert.equal(store.listServices().length, 200);
});

test('additive listed migration and restart preserve settings, sessions, history and archived seed services', (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'desideri-admin-catalog-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let store = createStore({ dataDir, business, now: () => now });
  const existing = store.createAdminAppointment(appointment());
  const received = store.createPublicRequest(request({ time: '12:00' }));
  store.updateService('taglio-donna', { durationMinutes: 45, enabled: true });
  store.updateSettings({ bookingEnabled: true, reminderTime: '17:30' });
  store.db.prepare('INSERT INTO owners(id,email,password_hash,created_at) VALUES(1,?,?,?)').run('jessica@example.test', 'unchanged-password-hash', now);
  store.db.prepare('INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,1,?,?,?)').run('unchanged-session', 'unchanged-csrf', now + 60_000, now);
  // Reproduce the former services schema while keeping all existing data.
  store.db.exec('ALTER TABLE services DROP COLUMN listed');
  store.close();
  store = createStore({ dataDir, business, now: () => now });
  assert.ok(store.listServices().every((service) => service.listed));
  assert.equal(store.getSettings().reminderTime, '17:30');
  assert.equal(store.getSettings().bookingEnabled, true);
  assert.equal(store.listAppointments({ from: '2026-10-06', to: '2026-10-06' })[0].id, existing.id);
  assert.equal(store.listRequests()[0].id, received.id);
  assert.equal(store.db.prepare('SELECT password_hash FROM owners').get().password_hash, 'unchanged-password-hash');
  assert.equal(store.db.prepare('SELECT csrf_token FROM sessions').get().csrf_token, 'unchanged-csrf');
  store.updateService('taglio-donna', { listed: false });
  store.close();
  store = createStore({ dataDir, business, now: () => now });
  t.after(() => store.close());
  assert.equal(store.listServices().find((item) => item.id === 'taglio-donna').listed, false);
  assert.equal(store.listServices().find((item) => item.id === 'taglio-donna').enabled, false);
  assert.equal(store.listServices().length, business.services.length);
  assert.ok(!store.getPublicConfig().requestServices.some((item) => item.id === 'taglio-donna'));
  assert.equal(store.confirmRequest(received.id).appointment.serviceId, 'taglio-donna');
  assert.equal(store.listCustomers()[0].appointmentCount, 2);
  assert.equal(store.listCustomers()[0].requestCount, 1);
});

test('directory normalizes legacy phone formats and uses latest names without treating requests as visits', (t) => {
  const store = fixture(t);
  const past = store.createAdminAppointment(appointment({ date: '2026-10-02', name: 'Nome vecchio' }));
  store.db.prepare('UPDATE appointments SET phone=? WHERE id=?').run('0039 350-012-3456', past.id);
  store.createAdminAppointment(appointment({ time: '10:00', name: 'Nome futuro' }), now + 100);
  store.createAdminAppointment(appointment({ date: '2026-10-08', time: '10:00' }), now + 150);
  const cancelled = store.createAdminAppointment(appointment({ time: '09:00' }), now + 180);
  store.updateAppointment(cancelled.id, { status: 'cancelled' }, now + 200);
  const received = store.createPublicRequest(request({ date: '2026-10-07', name: 'Anna Èlite' }), now + 250);
  store.declineRequest(received.id, now + 300);
  const entry = store.listCustomers()[0];
  assert.deepEqual(entry, {
    phone: '+393500123456', name: 'Anna Èlite', appointmentCount: 4, requestCount: 1,
    lastDate: '2026-10-02', nextDate: '2026-10-06',
  });
  assert.deepEqual(store.listCustomers({ query: 'anna elite' }), [entry]);
  assert.deepEqual(store.listCustomers({ query: '350-012 3456' }), [entry]);
  assert.deepEqual(store.listCustomers({ query: '0039 350' }), [entry]);
  assert.deepEqual(store.listCustomers({ query: 'non presente' }), []);
  assert.deepEqual(store.listCustomers({ query: 'Nome vecchio' }), []);
  const publicConfig = store.getPublicConfig();
  assert.ok(!JSON.stringify(publicConfig).includes(entry.phone));
  assert.ok(!JSON.stringify(publicConfig).includes(entry.name));
  const history = store.getCustomerHistory('0039 350-012-3456');
  assert.equal(history.appointments.length, 4);
  assert.equal(history.requests.length, 1);
  assert.ok(history.appointments.every((item) => item.phone === entry.phone));
  assert.equal(history.appointments.at(-1).id, past.id);
  assert.equal(history.requests[0].id, received.id);
  assert.equal(history.requests[0].serviceName, 'Taglio donna');
  assert.equal(history.requests[0].status, 'declined');
});

test('directory shows request-only clients with null appointment dates and bounds search and output', (t) => {
  const store = fixture(t);
  const first = store.createPublicRequest(request({ name: 'Solo Richiesta', phone: '+393500123458' }), now + 10);
  store.createPublicRequest(request({ name: 'Seconda Cliente', phone: '+393500123459' }), now + 20);
  const one = store.listCustomers({ limit: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0].name, 'Seconda Cliente');
  const requestOnly = store.listCustomers({ query: 'Solo' })[0];
  assert.equal(requestOnly.appointmentCount, 0);
  assert.equal(requestOnly.requestCount, 1);
  assert.equal(requestOnly.lastDate, null);
  assert.equal(requestOnly.nextDate, null);
  store.confirmRequest(first.id, { durationMinutes: 30 }, now + 30);
  const confirmed = store.listCustomers({ query: 'Solo' })[0];
  assert.equal(confirmed.appointmentCount, 1);
  assert.equal(confirmed.requestCount, 1);
  assert.equal(confirmed.nextDate, '2026-10-06');
  const history = store.getCustomerHistory(confirmed.phone, { limit: 1 });
  assert.equal(history.appointments.length, 1);
  assert.equal(history.requests.length, 1);
  assert.equal(history.requests[0].appointment.id, history.appointments[0].id);
  assert.equal(history.requests[0].name, 'Solo Richiesta');
  assert.deepEqual(store.getCustomerHistory('+393500123460'), { appointments: [], requests: [] });
  for (const limit of [0, 101, '30']) assert.throws(() => store.getCustomerHistory(confirmed.phone, { limit }), { code: 'invalid_input' });
  assert.throws(() => store.getCustomerHistory('3500123456'), { code: 'invalid_phone' });
  for (const invalid of [{ query: 123 }, { query: 'x'.repeat(101) }, { query: 'bad\nquery' }, { limit: 0 }, { limit: 201 }, { limit: '100' }]) {
    assert.throws(() => store.listCustomers(invalid), { code: 'invalid_input' });
  }
});
