import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, effectiveReminderLimits, reminderQuotaPeriod } from '../server/db.mjs';
import { createReminderRunner } from '../server/reminders.mjs';
import { createApp } from '../server/http.mjs';
import { localDateTimeToEpoch } from '../server/time.mjs';

const epoch = localDateTimeToEpoch;
const business = {
  businessName: 'Salone costi test', email: 'owner@example.test', services: [{ id: 'taglio', name: 'Taglio' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map((day) => ({ day, label: day, ranges: [{ opens: '06:00', closes: '23:00' }] })),
};
const whatsapp = {
  accessToken: 'cost-test-token-mocked-only', phoneNumberId: '123456789',
  templateName: 'promemoria', templateLanguage: 'it', graphVersion: 'v26.0',
  appSecret: 'cost-test-app-secret', verifyToken: 'cost-test-verify-token',
};

function fixture(t, { fetchImpl, configured = true } = {}) {
  let instant = epoch('2026-10-04', '17:30');
  const store = createStore({ dataDir: ':memory:', business, now: () => instant });
  const calls = [];
  const config = { whatsapp: configured ? { ...whatsapp } : {} };
  const runner = createReminderRunner({ store, config, now: () => instant, fetchImpl: fetchImpl || (async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.cost-test-${calls.length}` }] }));
  }) });
  t.after(async () => { await runner.stop(); store.close(); });
  const add = (index = 0, patch = {}) => {
    const minutes = 9 * 60 + index * 10;
    return store.createAdminAppointment({ title: 'Taglio', name: 'Cliente test', phone: '+393500000001', date: '2026-10-05',
      time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      durationMinutes: 5, reminderConsent: true, ...patch }, instant);
  };
  const job = (id, revision) => store.db.prepare(`SELECT * FROM reminders WHERE appointment_id=? ${revision ? 'AND appointment_revision=?' : ''} ORDER BY appointment_revision DESC`).get(...(revision ? [id, revision] : [id]));
  const claimAudit = (id, at = instant) => store.db.prepare("INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES('whatsapp_send_claimed',?,?,'')").run(id, at);
  return { store, runner, calls, config, add, job, claimAudit, now: () => instant,
    setNow: (value) => { instant = value; }, due: () => { instant = epoch('2026-10-04', '18:01'); } };
}

test('economy defaults are additive, preserve configured limits and keep lower or zero owner caps', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cost-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = createStore({ dataDir: directory, business });
  original.updateSettings({ dailyReminderLimit: 33, monthlyReminderLimit: 222 });
  original.db.prepare("DELETE FROM settings WHERE key='economyMode'").run();
  original.close();
  const upgraded = createStore({ dataDir: directory, business });
  try {
    const saved = upgraded.getSettings();
    assert.equal(saved.economyMode, true);
    assert.equal(saved.dailyReminderLimit, 33);
    assert.equal(saved.monthlyReminderLimit, 222);
    assert.deepEqual(effectiveReminderLimits(saved), { economyMode: true, configuredDailyLimit: 33, configuredMonthlyLimit: 222, dailyLimit: 10, monthlyLimit: 60 });
    upgraded.updateSettings({ economyMode: false });
    assert.equal(effectiveReminderLimits(upgraded.getSettings()).dailyLimit, 33);
    assert.equal(effectiveReminderLimits(upgraded.getSettings()).monthlyLimit, 222);
    upgraded.updateSettings({ economyMode: true, dailyReminderLimit: 0, monthlyReminderLimit: 7 });
    assert.equal(effectiveReminderLimits(upgraded.getSettings()).dailyLimit, 0);
    assert.equal(effectiveReminderLimits(upgraded.getSettings()).monthlyLimit, 7);
    assert.throws(() => upgraded.updateSettings({ economyMode: 'yes' }), (error) => error.status === 400);
    assert.equal(upgraded.getSettings().economyMode, true);
  } finally { upgraded.close(); }
});

test('default economy atomically sends at most ten daily and reports effective versus configured budgets', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 11; i++) f.add(i);
  f.due();
  assert.equal((await f.runner.tick()).processed, 10);
  assert.equal(f.calls.length, 10);
  const status = f.runner.getStatus();
  assert.equal(status.dailyLimit, 10);
  assert.equal(status.monthlyLimit, 60);
  assert.equal(status.configuredDailyLimit, 20);
  assert.equal(status.configuredMonthlyLimit, 200);
  assert.equal(status.remainingToday, 0);
  assert.equal(status.remainingThisMonth, 50);
  assert.equal(f.store.getStats(f.now()).sentThisMonth, 10);
  assert.equal((await f.runner.tick()).processed, 0);
  assert.equal(f.calls.length, 10);
});

test('monthly economy cap counts earlier send claims while leaving the next due job pending', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 60; i++) {
    const appointment = f.add(i);
    const reminder = f.job(appointment.id);
    f.store.db.prepare("UPDATE reminders SET status='accepted',provider_message_id=? WHERE id=?").run(`wamid.seed-${i}`, reminder.id);
    f.claimAudit(reminder.id, epoch('2026-10-01', '18:00'));
  }
  const next = f.add(60);
  f.due();
  assert.equal((await f.runner.tick()).processed, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.job(next.id).status, 'pending');
  assert.equal(f.runner.getStatus().remainingToday, 10);
  assert.equal(f.runner.getStatus().remainingThisMonth, 0);
  assert.equal(f.runner.getStatus().sentThisMonth, 60);
  assert.equal(f.store.getStats(f.now()).sentThisMonth, 60);
});

test('zero configured caps remain a complete pause in economy mode', async (t) => {
  const f = fixture(t);
  f.store.updateSettings({ dailyReminderLimit: 0, monthlyReminderLimit: 0 }, f.now());
  f.add(); f.due();
  assert.equal((await f.runner.tick()).processed, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.runner.getStatus().remainingToday, 0);
  assert.equal(f.runner.getStatus().remainingThisMonth, 0);
});

test('editing an accepted appointment blocks another paid revision and flags old reminder details', async (t) => {
  const f = fixture(t);
  const appointment = f.add();
  f.due(); await f.runner.tick();
  assert.equal(f.calls.length, 1);
  f.store.updateAppointment(appointment.id, { date: '2026-10-06', time: '11:00' }, f.now());
  assert.equal(f.job(appointment.id, 1).status, 'accepted');
  assert.equal(f.job(appointment.id, 2).status, 'skipped');
  assert.equal(f.job(appointment.id, 2).error_code, 'already_reminded');
  const rows = f.store.listReminders();
  assert.equal(rows.find((row) => row.id === f.job(appointment.id, 1).id).staleRevision, true);
  assert.equal(rows.find((row) => row.id === f.job(appointment.id, 2).id).staleRevision, false);
  // A previously planned pending revision is guarded at claim too, even with a full quota.
  f.store.db.prepare("UPDATE reminders SET status='pending',error_code=NULL WHERE appointment_id=? AND appointment_revision=2").run(appointment.id);
  f.store.updateSettings({ monthlyReminderLimit: 1 }, f.now());
  f.setNow(epoch('2026-10-05', '18:01'));
  await f.runner.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.job(appointment.id, 2).status, 'skipped');
  assert.equal(f.job(appointment.id, 2).error_code, 'already_reminded');
  assert.equal(f.store.getStats(f.now()).sentThisMonth, 1);
});

test('uncertain sends remain charged after manual acknowledgment and prevent all later automatic revisions', async (t) => {
  const f = fixture(t, { fetchImpl: async () => new Response('{}', { status: 503 }) });
  const appointment = f.add();
  f.due(); await f.runner.tick();
  const original = f.job(appointment.id);
  assert.equal(original.status, 'needs_review');
  assert.equal(f.runner.getStatus().sentThisMonth, 1);
  assert.equal(f.store.getStats(f.now()).sentThisMonth, 1);
  f.store.updateAppointment(appointment.id, { date: '2026-10-06' }, f.now());
  assert.equal(f.job(appointment.id).error_code, 'prior_send_uncertain');
  const acknowledged = f.store.markReminderManual(original.id, f.now());
  assert.equal(acknowledged.status, 'needs_review');
  assert.equal(acknowledged.manualSentAt, f.now());
  assert.equal(acknowledged.staleRevision, true);
  assert.deepEqual(f.store.markReminderManual(original.id, f.now() + 1000), acknowledged);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event='reminder_marked_manual'").get().count, 1);
  assert.equal(f.runner.getStatus().sentThisMonth, 1);
  assert.equal(f.store.getStats(f.now()).sentThisMonth, 1);
  f.store.updateAppointment(appointment.id, { time: '12:00' }, f.now());
  assert.equal(f.job(appointment.id).error_code, 'manual_sent');
  f.setNow(epoch('2026-10-05', '18:01'));
  assert.equal((await f.runner.tick()).processed, 0);
  assert.equal(f.runner.getStatus().sentThisMonth, 1);
});

test('explicit manual acknowledgment skips unsent jobs once and consumes no API allowance', async (t) => {
  for (const initialStatus of ['pending', 'failed', 'skipped']) await t.test(initialStatus, async (subtest) => {
    const f = fixture(subtest);
    const appointment = f.add();
    const reminder = f.job(appointment.id);
    f.store.db.prepare('UPDATE reminders SET status=? WHERE id=?').run(initialStatus, reminder.id);
    const saved = f.store.markReminderManual(reminder.id, f.now());
    assert.equal(saved.status, 'skipped');
    assert.equal(saved.manualSentAt, f.now());
    assert.deepEqual(f.store.markReminderManual(reminder.id, f.now() + 1), saved);
    assert.equal(f.runner.getStatus().sentThisMonth, 0);
    assert.equal(f.runner.getStatus().remainingThisMonth, 60);
    f.due(); await f.runner.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event='reminder_marked_manual'").get().count, 1);
  });
});

test('manual acknowledgment rejects in-flight, recorded provider, inactive or missing reminders', async (t) => {
  const f = fixture(t);
  for (const [index, status, provider, code] of [
    [0, 'sending', null, 'reminder_sending'], [1, 'accepted', null, 'reminder_already_sent'],
    [2, 'delivered', null, 'reminder_already_sent'], [3, 'read', null, 'reminder_already_sent'],
    [4, 'failed', 'wamid.provider-failed', 'reminder_already_sent'],
  ]) {
    const appointment = f.add(index);
    const reminder = f.job(appointment.id);
    f.store.db.prepare('UPDATE reminders SET status=?,provider_message_id=? WHERE id=?').run(status, provider, reminder.id);
    assert.throws(() => f.store.markReminderManual(reminder.id, f.now()), (error) => error.status === 409 && error.code === code);
  }
  const cancelled = f.add(5);
  f.store.updateAppointment(cancelled.id, { status: 'cancelled' }, f.now());
  assert.throws(() => f.store.markReminderManual(f.job(cancelled.id).id, f.now()), (error) => error.code === 'appointment_not_active');
  const past = f.add(6);
  assert.throws(() => f.store.markReminderManual(f.job(past.id).id, epoch('2026-10-05', '11:00')), (error) => error.code === 'appointment_not_active');
  assert.throws(() => f.store.markReminderManual('missing', f.now()), (error) => error.status === 404);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event='reminder_marked_manual'").get().count, 0);
});

test('paused, unconfigured and empty queues use no writer transactions but paused stale leases still recover', async (t) => {
  const f = fixture(t);
  let writes = 0;
  const transaction = f.store.transaction;
  f.store.transaction = (callback) => { writes++; return transaction(callback); };
  await f.runner.tick();
  assert.equal(writes, 0);
  const appointment = f.add();
  // Store CRUD uses its internal transaction, so this counter observes the runner only.
  await f.runner.tick(); assert.equal(writes, 0);
  f.due();
  f.config.whatsapp.enabled = false;
  await f.runner.tick(); assert.equal(writes, 0);
  f.config.whatsapp = {};
  await f.runner.tick(); assert.equal(writes, 0);
  f.store.db.prepare("UPDATE reminders SET status='sending',lease_until=? WHERE appointment_id=?").run(f.now() - 1, appointment.id);
  await f.runner.tick();
  assert.equal(writes, 1);
  assert.equal(f.job(appointment.id).status, 'needs_review');
  await f.runner.tick(); assert.equal(writes, 1);
  const pendingProvider = f.add(1);
  f.store.db.prepare("UPDATE reminders SET status='pending',provider_message_id='wamid.existing' WHERE appointment_id=?").run(pendingProvider.id);
  await f.runner.tick();
  assert.equal(writes, 2);
  assert.equal(f.job(pendingProvider.id).status, 'needs_review');
  assert.equal(f.calls.length, 0);
});

test('reminder day filters use Rome midnight across the 25-hour DST day without truncation', async (t) => {
  const f = fixture(t);
  const dayStart = epoch('2026-10-25', '00:00');
  const nextDay = epoch('2026-10-26', '00:00');
  assert.equal(nextDay - dayStart, 25 * 3_600_000);
  for (const [index, dueAt] of [dayStart - 1, dayStart, nextDay - 1, nextDay].entries()) {
    const appointment = f.add(index, { date: '2026-10-26' });
    f.store.db.prepare('UPDATE reminders SET due_at=? WHERE appointment_id=?').run(dueAt, appointment.id);
  }
  const rows = f.store.listReminders({ date: '2026-10-25' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.dueAt), [dayStart, nextDay - 1]);
  assert.equal(f.store.listReminders().length, 4);
  assert.equal(f.store.listReminders({ date: '2026-10-25', limit: 1 }).length, 1);
  assert.throws(() => f.store.listReminders({ date: '2026-02-30' }), (error) => error.status === 400);
  const period = reminderQuotaPeriod(epoch('2026-10-25', '12:00'));
  assert.equal(period.dayStart, dayStart);
  assert.equal(period.dayEnd, nextDay);
});

test('manual endpoint authenticates, requires Origin and CSRF, never sends, and returns filtered owner reminders', async (t) => {
  const instant = epoch('2026-10-04', '17:30');
  const directory = await mkdtemp(join(tmpdir(), 'cost-private-http-'));
  const token = 'cost-bootstrap-fixture-at-least-32-characters';
  const password = 'Cost portal password sicura 2026!';
  const app = createApp({ config: { origin: 'http://cost.test', host: '127.0.0.1', port: 0, dataDir: directory,
    business, bootstrapToken: token, bootstrapExpiresAt: new Date(instant + 3_600_000).toISOString(), whatsapp: {} }, now: () => instant });
  const address = await app.start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function call(path, { method = 'GET', body, cookie, csrf, origin = 'http://cost.test' } = {}) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method,
      headers: { ...(method === 'GET' ? {} : { Origin: origin }), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const owner = await call('/api/auth/setup', { method: 'POST', body: { token, password } });
  const auth = { cookie: owner.cookie, csrf: owner.data.csrfToken };
  const appointment = app.store.createAdminAppointment({ title: 'Taglio', date: '2026-10-05', time: '10:00', durationMinutes: 30, name: 'Ada', phone: '+393500000001', reminderConsent: true }, instant);
  const reminder = app.store.listReminders()[0];
  const endpoint = `/api/admin/reminders/${reminder.id}/manual`;
  assert.equal((await call(endpoint, { method: 'POST', body: {} })).status, 401);
  assert.equal((await call(endpoint, { ...auth, csrf: undefined, method: 'POST', body: {} })).status, 403);
  assert.equal((await call(endpoint, { ...auth, origin: 'https://other.test', method: 'POST', body: {} })).status, 403);
  const saved = await call(endpoint, { ...auth, method: 'POST', body: {} });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.appointmentId, appointment.id);
  assert.equal(saved.data.manualSentAt, instant);
  assert.equal(saved.data.status, 'skipped');
  assert.deepEqual((await call(endpoint, { ...auth, method: 'POST', body: {} })).data, saved.data);
  const automation = await call('/api/admin/automation', auth);
  assert.equal(automation.data.economyMode, true);
  assert.equal(automation.data.dailyLimit, 10);
  assert.equal(automation.data.configuredDailyLimit, 20);
  assert.equal(automation.data.remainingThisMonth, 60);
  assert.equal(automation.data.sentThisMonth, 0);
  assert.equal((await call('/api/admin/reminders?date=2026-10-04', auth)).data.items.length, 1);
  assert.equal((await call('/api/admin/reminders?date=2026-10-05', auth)).data.items.length, 0);
  assert.equal((await call('/api/admin/reminders?date=invalid', auth)).status, 400);
  assert.equal(saved.response.headers.get('cache-control'), 'no-store');
  assert.equal(app.store.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE event='whatsapp_send_claimed'").get().count, 0);
});
