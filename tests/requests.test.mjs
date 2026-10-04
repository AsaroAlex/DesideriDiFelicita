import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createStore } from '../server/db.mjs';
import { localDateTimeToEpoch, reminderDueAt } from '../server/time.mjs';

const business = {
  businessName: 'Desideri di Felicità',
  services: [{ name: 'Taglio donna' }, { name: 'Colore' }],
  openingHours: [
    { day: 'Monday', label: 'Lunedì', ranges: [] },
    { day: 'Tuesday', label: 'Martedì', ranges: [{ opens: '09:00', closes: '15:00' }, { opens: '17:00', closes: '19:00' }] },
    { day: 'Wednesday', label: 'Mercoledì', ranges: [{ opens: '09:00', closes: '15:00' }, { opens: '17:00', closes: '19:00' }] },
    { day: 'Thursday', label: 'Giovedì', ranges: [{ opens: '09:00', closes: '15:00' }] },
    { day: 'Friday', label: 'Venerdì', ranges: [{ opens: '09:00', closes: '13:00' }, { opens: '17:00', closes: '19:00' }] },
    { day: 'Saturday', label: 'Sabato', ranges: [{ opens: '09:00', closes: '13:00' }] },
    { day: 'Sunday', label: 'Domenica', ranges: [] },
  ],
};
const now = localDateTimeToEpoch('2026-10-05', '12:00');
const baseRequest = { serviceId: 'taglio-donna', date: '2026-10-06', time: '09:00', name: 'Anna Rossi', phone: '+39 350 012 3456', reminderConsent: true };
const request = (patch = {}) => ({ ...baseRequest, clientRequestId: randomUUID(), ...patch });
function fixture(t) {
  const store = createStore({ dataDir: ':memory:', business, now: () => now });
  t.after(() => store.close());
  return store;
}
function count(store, table) { return store.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; }
function activateInstant(store) {
  store.updateService('taglio-donna', { durationMinutes: 45, enabled: true });
  store.updateSettings({ bookingEnabled: true });
}

test('fresh salon exposes a real request calendar without inventing durations or an owner account', (t) => {
  const store = fixture(t);
  const config = store.getPublicConfig();
  assert.equal(config.bookingEnabled, false);
  assert.equal(config.requestEnabled, true);
  assert.deepEqual(config.services, []);
  assert.deepEqual(config.requestServices.map((service) => [service.id, service.durationMinutes, service.instantBooking]), [['taglio-donna', null, false], ['colore', null, false]]);
  assert.deepEqual(config.closedDates, []);
  const slots = store.getRequestAvailability({ serviceId: 'colore', date: baseRequest.date });
  assert.equal(slots.mode, 'request');
  assert.equal(slots.slots[0].time, '09:00');
  assert.ok(slots.slots.some((slot) => slot.time === '14:45'));
  assert.equal(slots.slots.at(-1).time, '18:45');
  assert.ok(slots.slots.every((slot) => slot.endsAt === null && !Object.hasOwn(slot, 'name') && !Object.hasOwn(slot, 'phone')));
  const saved = store.createPublicRequest(request({ serviceId: 'colore' }));
  assert.equal(saved.status, 'pending');
  assert.match(saved.reference, /^DR-[A-F0-9]{10}$/);
  assert.equal(saved.serviceName, 'Colore');
  assert.ok(!Object.hasOwn(saved, 'name') && !Object.hasOwn(saved, 'phone') && !Object.hasOwn(saved, 'appointment'));
  assert.equal(count(store, 'owners'), 0);
  assert.equal(count(store, 'appointments'), 0);
  assert.equal(count(store, 'reminders'), 0);
  assert.equal(store.getStats().pendingRequests, 1);
  assert.equal(store.getStats().upcomingAppointments, 0);
});

test('request preferences respect split hours, closed days, closures, future dates and occupied start points', (t) => {
  const store = fixture(t);
  store.createAdminAppointment({ ...baseRequest, time: '09:30', durationMinutes: 45, reminderConsent: false });
  const times = store.getRequestAvailability({ serviceId: baseRequest.serviceId, date: baseRequest.date }).slots.map((slot) => slot.time);
  assert.ok(times.includes('09:15') && times.includes('10:15'));
  assert.ok(!times.includes('09:30') && !times.includes('10:00'));
  assert.ok(!times.includes('15:00') && !times.includes('16:45') && !times.includes('19:00'));
  assert.deepEqual(store.getRequestAvailability({ serviceId: baseRequest.serviceId, date: '2026-10-11' }).slots, []);
  for (const time of ['09:31', '09:45', '15:00', '19:00']) assert.throws(() => store.createPublicRequest(request({ time })), { code: 'request_unavailable' });
  store.updateSettings({ closedDates: [baseRequest.date] });
  assert.deepEqual(store.getRequestAvailability({ serviceId: baseRequest.serviceId, date: baseRequest.date }).slots, []);
  assert.throws(() => store.createPublicRequest(request()), { code: 'request_unavailable' });
  for (const date of ['2026-10-04', '2027-01-01']) assert.throws(() => store.createPublicRequest(request({ date })), { code: 'date_out_of_range' });
  assert.throws(() => store.createPublicRequest(request({ serviceId: 'inventato' })), { code: 'invalid_service' });
  store.updateSettings({ closedDates: [] });
  assert.throws(() => store.createPublicRequest(request(), localDateTimeToEpoch(baseRequest.date, '09:00')), { code: 'request_unavailable' });
});

test('a pending request does not reserve an interval or produce reminders', (t) => {
  const store = fixture(t);
  const before = store.getRequestAvailability({ serviceId: baseRequest.serviceId, date: baseRequest.date }).slots;
  store.createPublicRequest(request());
  store.createPublicRequest(request({ phone: '+393500123457' }));
  assert.deepEqual(store.getRequestAvailability({ serviceId: baseRequest.serviceId, date: baseRequest.date }).slots, before);
  assert.equal(count(store, 'appointments'), 0);
  assert.equal(count(store, 'reminders'), 0);
});

test('canonical UUID retry keeps the same reference across response loss, pause, and decline', (t) => {
  const store = fixture(t);
  const input = request();
  const first = store.createPublicRequest(input);
  const retry = store.createPublicRequest({ ...input, clientRequestId: input.clientRequestId.toUpperCase(), name: '  Anna   Rossi  ', phone: '0039 350-012-3456' });
  assert.deepEqual(retry, first);
  assert.equal(count(store, 'booking_requests'), 1);
  assert.equal(count(store, 'audit_log'), 1);
  store.updateSettings({ requestEnabled: false });
  assert.deepEqual(store.createPublicRequest(input), first);
  assert.throws(() => store.createPublicRequest(request({ phone: '+393500123458' })), { code: 'request_disabled' });
  assert.throws(() => store.createPublicRequest({ ...input, time: '09:15' }), { code: 'request_id_reused' });
  assert.throws(() => store.createPublicRequest({ ...input, reminderConsent: false }), { code: 'request_id_reused' });
  assert.throws(() => store.createPublicRequest({ ...input, phone: '+393500123459' }), { code: 'request_id_reused' });
  assert.equal(store.declineRequest(first.id).status, 'declined');
  assert.equal(store.createPublicRequest(input).status, 'declined');
  assert.equal(count(store, 'booking_requests'), 1);
  for (const clientRequestId of ['', 'client-1', '00000000-0000-0000-0000-000000000000']) {
    assert.throws(() => store.createPublicRequest({ ...input, clientRequestId }), { code: 'invalid_request_id' });
  }
});

test('request settings pause requests independently of configured instant booking', (t) => {
  const store = fixture(t);
  activateInstant(store);
  store.updateSettings({ requestEnabled: false });
  const config = store.getPublicConfig();
  assert.equal(config.requestEnabled, false);
  assert.deepEqual(config.requestServices, []);
  assert.equal(config.bookingEnabled, true);
  assert.equal(config.services.length, 1);
  assert.throws(() => store.getRequestAvailability({ serviceId: baseRequest.serviceId, date: baseRequest.date }), { code: 'request_disabled' });
  assert.equal(store.createPublicBooking(baseRequest).status, 'confirmed');
  assert.throws(() => store.updateSettings({ requestEnabled: 'false' }), { code: 'invalid_input' });
  store.updateSettings({ requestEnabled: true });
  assert.equal(store.getPublicConfig().requestServices[0].instantBooking, true);
  assert.equal(store.getPublicConfig().requestServices[1].instantBooking, false);
});

test('three future pending and confirmed appointments share the public phone quota', (t) => {
  const store = fixture(t);
  for (const time of ['09:00', '10:00', '11:00']) store.createPublicRequest(request({ time }));
  assert.throws(() => store.createPublicRequest(request({ time: '12:00', phone: '00393500123456' })), { code: 'booking_limit' });
  activateInstant(store);
  assert.throws(() => store.createPublicBooking({ ...baseRequest, time: '12:00' }), { code: 'booking_limit' });
  const declined = store.declineRequest(store.listRequests()[0].id);
  assert.equal(declined.status, 'declined');
  const confirmed = store.createPublicBooking({ ...baseRequest, time: '12:00' });
  assert.equal(confirmed.status, 'confirmed');
  assert.throws(() => store.createPublicRequest(request({ time: '13:00' })), { code: 'booking_limit' });
  assert.throws(() => store.createPublicBooking({ ...baseRequest, time: '13:00' }), { code: 'booking_limit' });
  assert.equal(store.createPublicRequest(request({ time: '13:00', phone: '+393500123457' })).status, 'pending');
});

test('confirming a request needs a real duration and validates the whole appointment interval atomically', (t) => {
  const store = fixture(t);
  const received = store.createPublicRequest(request({ time: '14:45' }));
  assert.throws(() => store.confirmRequest(received.id, {}), { code: 'invalid_input' });
  for (const durationMinutes of [null, 4, 481, 30.5]) assert.throws(() => store.confirmRequest(received.id, { durationMinutes }), { code: 'invalid_input' });
  assert.throws(() => store.confirmRequest(received.id, { durationMinutes: 45 }), { code: 'slot_unavailable' });
  assert.throws(() => store.confirmRequest(received.id, { date: '2026-10-11', time: '09:00', durationMinutes: 45 }), { code: 'slot_unavailable' });
  store.updateSettings({ closedDates: ['2026-10-07'] });
  assert.throws(() => store.confirmRequest(received.id, { date: '2026-10-07', time: '09:00', durationMinutes: 45 }), { code: 'slot_unavailable' });
  assert.throws(() => store.confirmRequest(received.id, { date: '2026-10-04', time: '09:00', durationMinutes: 45 }), { code: 'date_out_of_range' });
  assert.equal(store.listRequests()[0].status, 'pending');
  assert.equal(count(store, 'appointments'), 0);
  assert.equal(count(store, 'reminders'), 0);
  const actual = store.confirmRequest(received.id, { time: '17:00', durationMinutes: 60 });
  assert.equal(actual.appointment.time, '17:00');
  assert.equal(actual.appointment.durationMinutes, 60);
  assert.equal(actual.appointment.serviceId, baseRequest.serviceId);
  assert.equal(actual.appointment.reminderConsent, true);
  assert.equal(actual.request.appointmentId, actual.appointment.id);
  assert.equal(actual.request.appointment.time, '17:00');
  assert.equal(actual.request.time, '14:45');
  assert.equal(count(store, 'appointments'), 1);
  assert.equal(count(store, 'reminders'), 1);
  assert.equal(store.listReminders()[0].dueAt, reminderDueAt(baseRequest.date));
  assert.equal(store.getStats().pendingRequests, 0);
});

test('owner confirmation checks confirmed overlaps and keeps the request pending after a conflict', (t) => {
  const store = fixture(t);
  const pending = store.createPublicRequest(request());
  store.createAdminAppointment({ ...baseRequest, time: '10:00', durationMinutes: 45, reminderConsent: false });
  assert.throws(() => store.confirmRequest(pending.id, { durationMinutes: 90 }), { code: 'slot_conflict' });
  assert.equal(store.listRequests()[0].status, 'pending');
  assert.equal(store.listRequests()[0].appointmentId, null);
  assert.equal(count(store, 'appointments'), 1);
  assert.equal(count(store, 'reminders'), 0);
  const confirmed = store.confirmRequest(pending.id, { durationMinutes: 45 });
  const repeat = store.confirmRequest(pending.id, { time: '11:00', durationMinutes: 30 });
  assert.equal(repeat.appointment.id, confirmed.appointment.id);
  assert.equal(repeat.appointment.time, '09:00');
  assert.equal(count(store, 'appointments'), 2);
  assert.equal(count(store, 'reminders'), 1);
  assert.throws(() => store.declineRequest(pending.id), { code: 'request_not_pending' });
  store.updateAppointment(confirmed.appointment.id, { status: 'cancelled' });
  assert.equal(store.confirmRequest(pending.id).appointment.status, 'cancelled');
  assert.equal(count(store, 'appointments'), 2);
  assert.equal(count(store, 'reminders'), 1);
});

test('known duration may be used for an owner confirmation without enabling instant booking', (t) => {
  const store = fixture(t);
  const pending = store.createPublicRequest(request({ reminderConsent: false }));
  store.updateService(baseRequest.serviceId, { durationMinutes: 35 });
  const confirmed = store.confirmRequest(pending.id);
  assert.equal(confirmed.appointment.durationMinutes, 35);
  assert.equal(store.getPublicConfig().bookingEnabled, false);
  assert.equal(count(store, 'reminders'), 0);
  assert.equal(store.listRequests({ status: 'confirmed' })[0].appointment.status, 'confirmed');
});

test('public retries after owner changes show the actual appointment and never resurrect a cancellation', (t) => {
  const store = fixture(t);
  const input = request();
  const original = store.createPublicRequest(input);
  const confirmed = store.confirmRequest(original.id, { time: '11:00', durationMinutes: 45 });
  const receipt = store.createPublicRequest(input);
  assert.equal(receipt.reference, original.reference);
  assert.equal(receipt.status, 'confirmed');
  assert.equal(receipt.time, '11:00');
  store.updateAppointment(confirmed.appointment.id, { date: '2026-10-07', time: '14:00', title: 'Taglio e piega' });
  const moved = store.createPublicRequest(input);
  assert.equal(moved.date, '2026-10-07');
  assert.equal(moved.time, '14:00');
  assert.equal(moved.serviceName, 'Taglio e piega');
  assert.ok(!Object.hasOwn(moved, 'name') && !Object.hasOwn(moved, 'phone') && !Object.hasOwn(moved, 'appointment'));
  store.updateAppointment(confirmed.appointment.id, { status: 'cancelled' });
  assert.equal(store.createPublicRequest(input).status, 'cancelled');
  assert.equal(store.confirmRequest(original.id).appointment.status, 'cancelled');
  assert.equal(store.listRequests({ status: 'confirmed' })[0].status, 'confirmed');
  assert.equal(count(store, 'appointments'), 1);
  assert.equal(count(store, 'reminders'), 2);
});

test('decline is idempotent and cannot create an appointment or reminder', (t) => {
  const store = fixture(t);
  const pending = store.createPublicRequest(request());
  const first = store.declineRequest(pending.id);
  assert.deepEqual(store.declineRequest(pending.id), first);
  assert.throws(() => store.confirmRequest(pending.id, { durationMinutes: 45 }), { code: 'request_not_pending' });
  assert.deepEqual(store.listRequests(), []);
  assert.equal(store.listRequests({ status: 'declined' }).length, 1);
  assert.equal(count(store, 'appointments'), 0);
  assert.equal(count(store, 'reminders'), 0);
  assert.throws(() => store.listRequests({ status: 'all' }), { code: 'invalid_status' });
  assert.throws(() => store.listRequests({ limit: 501 }), { code: 'invalid_input' });
  assert.throws(() => store.confirmRequest('missing', { durationMinutes: 45 }), { code: 'request_not_found' });
});

test('additive migration preserves the former database and requests survive a restart', (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'desideri-request-migration-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let store = createStore({ dataDir, business, now: () => now });
  const existing = store.createAdminAppointment({ ...baseRequest, time: '12:00', durationMinutes: 45 });
  store.db.prepare('INSERT INTO owners(id,email,password_hash,created_at) VALUES(1,?,?,?)').run('jessica@example.test', 'untouched-hash', now);
  store.db.prepare('INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,1,?,?,?)').run('unchanged-session', 'unchanged-csrf', now + 60_000, now);
  store.db.exec('DROP TABLE booking_requests;');
  store.db.prepare("DELETE FROM settings WHERE key='requestEnabled'").run();
  store.close();
  store = createStore({ dataDir, business, now: () => now });
  assert.equal(store.getSettings().requestEnabled, true);
  assert.equal(store.getPublicConfig().bookingEnabled, false);
  assert.equal(store.listAppointments({ from: baseRequest.date, to: baseRequest.date })[0].id, existing.id);
  assert.equal(count(store, 'reminders'), 1);
  assert.equal(store.db.prepare('SELECT password_hash FROM owners').get().password_hash, 'untouched-hash');
  assert.equal(store.db.prepare('SELECT csrf_token FROM sessions').get().csrf_token, 'unchanged-csrf');
  const input = request();
  const received = store.createPublicRequest(input);
  store.close();
  store = createStore({ dataDir, business, now: () => now });
  t.after(() => store.close());
  assert.deepEqual(store.createPublicRequest(input), received);
  assert.equal(store.listRequests()[0].phone, '+393500123456');
  assert.equal(count(store, 'booking_requests'), 1);
  assert.equal(count(store, 'appointments'), 1);
});

test('concurrent duplicate request submissions and competing confirmations create a single appointment', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'desideri-request-concurrency-'));
  const store = createStore({ dataDir, business, now: () => now });
  t.after(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const input = request();
  const module = new URL('../server/db.mjs', import.meta.url).href;
  async function race(operation, ids = []) {
    const ready = [];
    const workers = Array.from({ length: 4 }, (_, index) => new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { createStore } = await import(workerData.module);
        const store = createStore({ dataDir: workerData.dataDir, business: workerData.business, now: () => workerData.now });
        parentPort.postMessage({ ready: true });
        parentPort.once('message', () => {
          try {
            const result = workerData.operation === 'request' ? store.createPublicRequest(workerData.input) : store.confirmRequest(workerData.ids[workerData.index % workerData.ids.length], { durationMinutes: 45 });
            parentPort.postMessage({ success: true, id: workerData.operation === 'request' ? result.id : result.appointment.id });
          } catch (error) { parentPort.postMessage({ success: false, code: error.code }); }
          finally { store.close(); }
        });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { dataDir, business, now, input, module, operation, ids, index } }));
    const outcomes = workers.map((worker) => new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', (message) => {
        if (message.ready) { ready.push(worker); if (ready.length === workers.length) ready.forEach((active) => active.postMessage('go')); }
        else resolve(message);
      });
    }));
    const results = await Promise.all(outcomes);
    await Promise.all(workers.map((worker) => worker.terminate()));
    return results;
  }
  const retries = await race('request');
  assert.ok(retries.every((result) => result.success));
  assert.equal(new Set(retries.map((result) => result.id)).size, 1);
  assert.equal(count(store, 'booking_requests'), 1);
  const competing = store.createPublicRequest(request({ phone: '+393500123457' }));
  const confirmations = await race('confirm', [retries[0].id, competing.id]);
  assert.equal(new Set(confirmations.filter((result) => result.success).map((result) => result.id)).size, 1);
  assert.equal(confirmations.filter((result) => !result.success && result.code === 'slot_conflict').length, 2);
  assert.equal(count(store, 'appointments'), 1);
  assert.equal(count(store, 'reminders'), 1);
  assert.equal(store.listRequests().length, 1);
});
