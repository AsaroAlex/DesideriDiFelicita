import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
const booking = { serviceId: 'taglio-donna', date: '2026-10-06', time: '09:00', name: 'Anna Rossi', phone: '+39 350 012 3456', reminderConsent: true };
function fixture(t, { enabled = true, at = now } = {}) {
  const store = createStore({ dataDir: ':memory:', business, now: () => at });
  t.after(() => store.close());
  if (enabled) {
    store.updateService('taglio-donna', { durationMinutes: 45, enabled: true });
    store.updateSettings({ bookingEnabled: true });
  }
  return store;
}

test('new salon has no invented service durations or public availability', (t) => {
  const store = fixture(t, { enabled: false });
  assert.equal(store.getPublicConfig().bookingEnabled, false);
  assert.deepEqual(store.getPublicConfig().services, []);
  assert.ok(store.listServices().every((service) => service.durationMinutes === null && !service.enabled));
  assert.throws(() => store.updateService('taglio-donna', { enabled: true }), { code: 'duration_required' });
  assert.throws(() => store.updateSettings({ bookingEnabled: true }), { code: 'services_not_ready' });
  assert.throws(() => store.getAvailability({ serviceId: 'taglio-donna', date: booking.date }), { code: 'booking_disabled' });
  assert.throws(() => store.createAdminAppointment({ ...booking }), { code: 'invalid_input' });
  assert.equal(store.createAdminAppointment({ ...booking, durationMinutes: 50 }).durationMinutes, 50);
});

test('availability respects split shifts, closures, durations, future dates and occupants', (t) => {
  const store = fixture(t);
  const slots = store.getAvailability({ serviceId: booking.serviceId, date: booking.date }).slots;
  assert.equal(slots[0].time, '09:00');
  assert.ok(slots.some((slot) => slot.time === '14:15'));
  assert.ok(!slots.some((slot) => slot.time === '14:30' || slot.time === '15:00' || slot.time === '16:45'));
  assert.equal(slots.at(-1).time, '18:15');
  store.createPublicBooking(booking);
  const occupied = store.getAvailability({ serviceId: booking.serviceId, date: booking.date }).slots;
  assert.deepEqual(occupied.slice(0, 2).map((slot) => slot.time), ['09:45', '10:00']);
  assert.ok(occupied.every((slot) => !Object.hasOwn(slot, 'phone') && !Object.hasOwn(slot, 'name')));
  assert.deepEqual(store.getAvailability({ serviceId: booking.serviceId, date: '2026-10-11' }).slots, []);
  store.updateSettings({ closedDates: ['2026-10-07'] });
  assert.deepEqual(store.getAvailability({ serviceId: booking.serviceId, date: '2026-10-07' }).slots, []);
  assert.throws(() => store.getAvailability({ serviceId: booking.serviceId, date: '2026-10-04' }), { code: 'date_out_of_range' });
  assert.throws(() => store.getAvailability({ serviceId: booking.serviceId, date: '2027-01-01' }), { code: 'date_out_of_range' });
  assert.throws(() => store.createPublicBooking({ ...booking, time: '15:00' }), { code: 'slot_unavailable' });
  assert.throws(() => store.createPublicBooking({ ...booking, time: '10:01' }), { code: 'slot_unavailable' });
});

test('overlapping appointment, cancellation and rescheduling are atomic', (t) => {
  const store = fixture(t);
  const first = store.createPublicBooking(booking);
  assert.throws(() => store.createPublicBooking({ ...booking, time: '09:30' }), { code: 'slot_conflict' });
  assert.equal(store.listAppointments({ from: booking.date, to: booking.date }).length, 1);
  const second = store.createAdminAppointment({ ...booking, time: '10:00' });
  assert.throws(() => store.updateAppointment(second.id, { time: '09:15' }), { code: 'slot_conflict' });
  assert.equal(store.listAppointments({ from: booking.date, to: booking.date }).find((a) => a.id === second.id).time, '10:00');
  store.updateAppointment(first.id, { status: 'cancelled' });
  assert.equal(store.getAvailability({ serviceId: booking.serviceId, date: booking.date }).slots[0].time, '09:00');
  const moved = store.updateAppointment(second.id, { time: '09:00' });
  assert.equal(moved.revision, 2);
  const cancelledJobs = store.db.prepare('SELECT * FROM reminders WHERE appointment_id=?').all(first.id);
  assert.equal(cancelledJobs[0].status, 'skipped');
  assert.equal(cancelledJobs[0].error_code, 'appointment_cancelled');
  const movedJobs = store.db.prepare('SELECT * FROM reminders WHERE appointment_id=? ORDER BY appointment_revision').all(second.id);
  assert.deepEqual(movedJobs.map((job) => job.status), ['skipped', 'pending']);
});

test('concurrent callers using separate connections cannot claim overlapping slots', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'desideri-booking-concurrency-'));
  const store = createStore({ dataDir, business, now: () => now });
  t.after(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  store.updateService('taglio-donna', { durationMinutes: 45, enabled: true });
  store.updateSettings({ bookingEnabled: true });
  const ready = [];
  const workers = Array.from({ length: 4 }, (_, index) => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createStore } = await import(workerData.module);
      const store = createStore({ dataDir: workerData.dataDir, business: workerData.business, now: () => workerData.now });
      parentPort.postMessage({ ready: true });
      parentPort.once('message', () => {
        try { store.createPublicBooking({ ...workerData.booking, phone: '+39350012345' + workerData.index }); parentPort.postMessage({ success: true }); }
        catch (error) { parentPort.postMessage({ success: false, code: error.code }); }
        finally { store.close(); }
      });
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { module: new URL('../server/db.mjs', import.meta.url).href, dataDir, business, now, booking, index } }));
  const outcomes = workers.map((worker) => new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', (message) => {
      if (message.ready) { ready.push(worker); if (ready.length === workers.length) ready.forEach((active) => active.postMessage('go')); }
      else resolve(message);
    });
  }));
  const results = await Promise.all(outcomes);
  await Promise.all(workers.map((worker) => worker.terminate()));
  assert.equal(results.filter((result) => result.success).length, 1);
  assert.equal(results.filter((result) => result.code === 'slot_conflict').length, 3);
  assert.equal(store.listAppointments({ from: booking.date, to: booking.date }).length, 1);
});

test('reminders need explicit consent, use previous Rome day and skip additions after cutoff', (t) => {
  const store = fixture(t);
  const first = store.createPublicBooking(booking);
  assert.equal(store.listReminders()[0].dueAt, reminderDueAt(booking.date));
  assert.equal(store.listReminders()[0].status, 'pending');
  const none = store.createAdminAppointment({ ...booking, time: '10:00', reminderConsent: false });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM reminders WHERE appointment_id=?').get(none.id).count, 0);
  store.updateAppointment(first.id, { reminderConsent: false });
  assert.equal(store.listReminders()[0].status, 'skipped');
  store.createAdminAppointment({ ...booking, time: '11:00' }, localDateTimeToEpoch('2026-10-05', '18:01'));
  assert.ok(store.listReminders().some((reminder) => reminder.status === 'skipped' && reminder.errorCode === 'after_cutoff'));
  assert.throws(() => store.createPublicBooking({ ...booking, time: '12:00', reminderConsent: undefined }), { code: 'invalid_input' });
  assert.throws(() => store.createPublicBooking({ ...booking, time: '12:00', phone: '3500123456' }), { code: 'invalid_phone' });
});

test('cosmetic changes do not create a second reminder after accepted send', (t) => {
  const store = fixture(t);
  const first = store.createPublicBooking(booking);
  const job = store.db.prepare('SELECT * FROM reminders WHERE appointment_id=?').get(first.id);
  store.db.prepare("UPDATE reminders SET status='accepted',provider_message_id='wamid.test' WHERE id=?").run(job.id);
  const updated = store.updateAppointment(first.id, { name: 'Anna Bianchi', title: 'Taglio personalizzato' });
  assert.equal(updated.revision, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM reminders WHERE appointment_id=?').get(first.id).count, 1);
  store.updateSettings({ reminderTime: '19:00' });
  assert.equal(store.db.prepare('SELECT due_at FROM reminders WHERE id=?').get(job.id).due_at, job.due_at);
});

test('service duration updates preserve existing bookings and unknown duration disables booking', (t) => {
  const store = fixture(t);
  const first = store.createPublicBooking(booking);
  store.updateService(booking.serviceId, { durationMinutes: 60 });
  assert.equal(store.listAppointments({ from: booking.date, to: booking.date })[0].durationMinutes, first.durationMinutes);
  store.updateService(booking.serviceId, { durationMinutes: null });
  assert.equal(store.listServices()[0].enabled, false);
  assert.equal(store.getPublicConfig().bookingEnabled, false);
});

test('settings validation and replanning preserve history and private internal keys', (t) => {
  const store = fixture(t);
  store.createPublicBooking(booking);
  store.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('whatsapp_status:private', JSON.stringify({ status: 'delivered' }));
  assert.ok(!Object.hasOwn(store.getSettings(), 'whatsapp_status:private'));
  assert.throws(() => store.updateSettings({ bookingDays: 0 }), { code: 'invalid_input' });
  assert.throws(() => store.updateSettings({ unknown: true }), { code: 'invalid_setting' });
  const badHours = structuredClone(business.openingHours);
  badHours[1].ranges.push({ opens: '14:00', closes: '18:00' });
  assert.throws(() => store.updateSettings({ openingHours: badHours }), { code: 'invalid_hours' });
  store.updateSettings({ reminderTime: '19:00' });
  assert.equal(store.listReminders()[0].dueAt, reminderDueAt(booking.date, '19:00'));
  assert.equal(store.getSettings().bookingDays, 60);
});

test('monthly sent statistics use immutable send claims, not webhook update time', (t) => {
  const store = fixture(t);
  store.createPublicBooking(booking);
  const job = store.db.prepare('SELECT * FROM reminders').get();
  store.db.prepare("UPDATE reminders SET status='read',updated_at=? WHERE id=?").run(localDateTimeToEpoch('2026-11-01', '09:00'), job.id);
  store.db.prepare("INSERT INTO audit_log(event,resource_id,created_at) VALUES('whatsapp_send_claimed',?,?)").run(job.id, localDateTimeToEpoch('2026-10-05', '18:00'));
  assert.equal(store.getStats(localDateTimeToEpoch('2026-10-31', '09:00')).sentThisMonth, 1);
  assert.equal(store.getStats(localDateTimeToEpoch('2026-11-01', '10:00')).sentThisMonth, 0);
  store.db.prepare("UPDATE reminders SET status='failed',provider_message_id='wamid.accepted-but-undelivered' WHERE id=?").run(job.id);
  assert.equal(store.getStats(localDateTimeToEpoch('2026-10-31', '09:00')).sentThisMonth, 1);
});

test('moving reminder time never revives sent failures or resets automatic retry caps', (t) => {
  const store = fixture(t);
  const first = store.createPublicBooking(booking);
  const second = store.createAdminAppointment({ ...booking, time: '10:00' });
  const third = store.createAdminAppointment({ ...booking, time: '11:00' });
  store.db.prepare("UPDATE reminders SET status='failed',provider_message_id='wamid.known',attempt_count=1 WHERE appointment_id=?").run(first.id);
  store.db.prepare("UPDATE reminders SET status='failed',attempt_count=3 WHERE appointment_id=?").run(second.id);
  store.db.prepare('UPDATE reminders SET attempt_count=2 WHERE appointment_id=?').run(third.id);
  store.updateSettings({ reminderTime: '19:00' });
  const rows = store.db.prepare('SELECT * FROM reminders ORDER BY appointment_id').all();
  assert.equal(rows.find((row) => row.appointment_id === first.id).status, 'failed');
  assert.equal(rows.find((row) => row.appointment_id === second.id).attempt_count, 3);
  assert.equal(rows.find((row) => row.appointment_id === third.id).attempt_count, 2);
  store.updateAppointment(first.id, { status: 'cancelled' });
  assert.equal(store.db.prepare('SELECT status FROM reminders WHERE appointment_id=?').get(first.id).status, 'failed');
});

test('private daily SQLite backup is readable and appointment data survives reopening', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'desideri-booking-backup-'));
  let backupNow = now;
  const store = createStore({ dataDir, business, now: () => backupNow });
  t.after(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  store.createAdminAppointment({ ...booking, durationMinutes: 45 });
  const destination = await store.backup();
  assert.ok(existsSync(destination));
  const saved = new DatabaseSync(destination, { readOnly: true });
  assert.equal(saved.prepare('SELECT COUNT(*) AS count FROM appointments').get().count, 1);
  assert.equal(saved.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  saved.close();
  for (let day = 1; day <= 8; day++) {
    backupNow = now + day * 86_400_000;
    await store.backup();
  }
  assert.equal(readdirSync(join(dataDir, 'backups')).length, 7);
  assert.equal(existsSync(destination), false);
  const copy = createStore({ dataDir, business, now: () => now });
  assert.equal(copy.listAppointments({ from: booking.date, to: booking.date }).length, 1);
  copy.close();
});
