import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createStore } from '../server/db.mjs';
import { localDateTimeToEpoch } from '../server/time.mjs';
import { createReminderRunner } from '../server/reminders.mjs';

const whatsapp = {
  accessToken: 'test-token-never-sent', phoneNumberId: '123456', templateName: 'promemoria_appuntamento',
  templateLanguage: 'it', graphVersion: 'v26.0', appSecret: 'test-app-secret', verifyToken: 'test-verify-token',
};
const business = {
  businessName: 'Salone test', email: 'owner@example.test', services: [{ name: 'Piega' }],
  openingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map((day) => ({ day, label: day, ranges: [{ opens: '06:00', closes: '23:00' }] })),
};
const epoch = (date, time) => localDateTimeToEpoch(date, time);
const accepted = (id = 'wamid.test-1') => new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });

function fixture(t, { fetchImpl, whatsappPatch = {} } = {}) {
  let instant = epoch('2026-10-04', '17:30');
  const store = createStore({ dataDir: ':memory:', business, now: () => instant });
  const requests = [];
  const mockedFetch = fetchImpl || (async (url, options) => {
    requests.push({ url, options });
    return accepted(`wamid.test-${requests.length}`);
  });
  const config = { whatsapp: { ...whatsapp, ...whatsappPatch } };
  const runner = createReminderRunner({ store, config, fetchImpl: mockedFetch, now: () => instant });
  t.after(async () => { await runner.stop(); store.close(); });
  const add = (time = '10:00', patch = {}) => store.createAdminAppointment({
    title: 'Piega', date: '2026-10-05', time, durationMinutes: 30,
    name: 'Ada', phone: '+393500000001', reminderConsent: true, ...patch,
  }, instant);
  const due = () => { instant = epoch('2026-10-04', '18:01'); };
  const job = (appointmentId) => store.db.prepare('SELECT * FROM reminders WHERE appointment_id=? ORDER BY appointment_revision DESC').get(appointmentId);
  const webhook = (value) => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: whatsapp.phoneNumberId }, ...value } }] }] }));
    return runner.handleWebhook({
      method: 'POST', rawBody,
      signature: `sha256=${createHmac('sha256', whatsapp.appSecret).update(rawBody).digest('hex')}`,
    });
  };
  return {
    store, runner, config, requests, mockedFetch, add, due, job, webhook,
    now: () => instant, setNow: (value) => { instant = value; },
  };
}

test('claims once and sends only the three approved utility-template parameters', async (t) => {
  const f = fixture(t);
  const appointment = f.add();
  f.due();
  assert.deepEqual(await f.runner.tick(), { processed: 1 });
  assert.equal(f.job(appointment.id).status, 'accepted');
  assert.equal(f.job(appointment.id).provider_message_id, 'wamid.test-1');
  assert.equal(f.requests[0].url, 'https://graph.facebook.com/v26.0/123456/messages');
  const body = JSON.parse(f.requests[0].options.body);
  assert.equal(body.to, '393500000001');
  assert.equal(body.type, 'template');
  assert.equal(body.template.name, 'promemoria_appuntamento');
  assert.deepEqual(body.template.components, [{ type: 'body', parameters: [
    { type: 'text', text: 'Ada' }, { type: 'text', text: '05/10/2026' }, { type: 'text', text: '10:00' },
  ] }]);
  await f.runner.tick();
  const restarted = createReminderRunner({ store: f.store, config: f.config, fetchImpl: f.mockedFetch, now: f.now });
  await restarted.tick();
  await restarted.stop();
  assert.equal(f.requests.length, 1);
});

test('missing credentials never sends and does not pretend automation is configured', async (t) => {
  const f = fixture(t, { whatsappPatch: { accessToken: '' } });
  const appointment = f.add();
  f.due();
  assert.equal(f.runner.getStatus().configured, false);
  assert.deepEqual(f.runner.getStatus().missing, ['WHATSAPP_ACCESS_TOKEN']);
  assert.equal((await f.runner.tick()).processed, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.job(appointment.id).status, 'pending');
});

test('an expired claim after a restart requires review and cannot be resent', async (t) => {
  const f = fixture(t);
  const appointment = f.add();
  f.due();
  f.store.db.prepare("UPDATE reminders SET status='sending',attempt_count=1,lease_until=? WHERE appointment_id=?")
    .run(f.now() - 1, appointment.id);
  await f.runner.tick();
  await f.runner.tick();
  assert.equal(f.job(appointment.id).status, 'needs_review');
  assert.equal(f.job(appointment.id).error_code, 'INTERRUPTED_SEND');
  assert.equal(f.requests.length, 0);
});

test('cancelled, non-consenting, rescheduled and past appointments cannot send', async (t) => {
  const f = fixture(t);
  const cancelled = f.add('08:00');
  const noConsent = f.add('09:00');
  const rescheduled = f.add('10:00');
  const past = f.add('11:00');
  f.store.updateAppointment(cancelled.id, { status: 'cancelled' }, f.now());
  f.store.db.prepare('UPDATE appointments SET reminder_consent=0 WHERE id=?').run(noConsent.id);
  f.store.db.prepare('UPDATE appointments SET revision=revision+1 WHERE id=?').run(rescheduled.id);
  f.setNow(epoch('2026-10-05', '12:00'));
  await f.runner.tick();
  for (const appointment of [cancelled, noConsent, rescheduled, past]) assert.equal(f.job(appointment.id).status, 'skipped');
  assert.equal(f.job(noConsent.id).error_code, 'no_consent');
  assert.equal(f.job(rescheduled.id).error_code, 'rescheduled');
  assert.equal(f.job(past.id).error_code, 'appointment_past');
  assert.equal(f.requests.length, 0);
});

test('rechecks queued appointments after an earlier request is in flight', async (t) => {
  for (const mutation of ['cancel', 'reschedule']) {
    await t.test(mutation, async (subtest) => {
      let resolveFetch;
      let calls = 0;
      const f = fixture(subtest, { fetchImpl: () => {
        calls += 1;
        return new Promise((resolve) => { resolveFetch = resolve; });
      } });
      f.add('09:00');
      const second = f.add('10:00');
      f.due();
      const tick = f.runner.tick();
      assert.equal(calls, 1);
      f.store.updateAppointment(second.id, mutation === 'cancel'
        ? { status: 'cancelled' } : { date: '2026-10-06' }, f.now());
      resolveFetch(accepted());
      await tick;
      assert.equal(calls, 1);
      assert.equal(f.store.db.prepare('SELECT status FROM reminders WHERE appointment_id=? AND appointment_revision=1').get(second.id).status, 'skipped');
    });
  }
});

test('parallel runners atomically reserve quota before contacting Meta', async (t) => {
  let resolveFetch;
  let calls = 0;
  const f = fixture(t, { fetchImpl: () => {
    calls += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  } });
  f.store.updateSettings({ dailyReminderLimit: 1 }, f.now());
  f.add('09:00');
  f.add('10:00');
  f.due();
  const firstTick = f.runner.tick();
  assert.equal((await f.runner.tick()).busy, true);
  const second = createReminderRunner({ store: f.store, config: f.config, fetchImpl: f.mockedFetch, now: f.now });
  assert.equal((await second.tick()).processed, 0);
  resolveFetch(accepted());
  await firstTick;
  await second.stop();
  assert.equal(calls, 1);
});

test('daily limit resets in Rome while monthly limit remains enforced', async (t) => {
  const f = fixture(t);
  f.store.updateSettings({ dailyReminderLimit: 1, monthlyReminderLimit: 2 }, f.now());
  f.add('09:00');
  f.add('10:00');
  f.add('09:00', { date: '2026-10-06' });
  f.add('10:00', { date: '2026-10-06' });
  f.due();
  await f.runner.tick();
  assert.equal(f.requests.length, 1);
  // Yesterday's unprocessed reminder expires at local midnight, even though
  // the appointment itself is still in the future.
  f.setNow(epoch('2026-10-05', '00:01'));
  await f.runner.tick();
  assert.equal(f.requests.length, 1);
  f.setNow(epoch('2026-10-05', '18:01'));
  await f.runner.tick();
  assert.equal(f.requests.length, 2);
  assert.equal(f.runner.getStatus().sentThisMonth, 2);
});

test('late restart or credentials activation never sends the previous evening backlog', async (t) => {
  const f = fixture(t);
  const appointment = f.add('10:00');
  f.setNow(epoch('2026-10-05', '00:01'));
  await f.runner.tick();
  assert.equal(f.requests.length, 0);
  assert.equal(f.job(appointment.id).status, 'skipped');
  assert.equal(f.job(appointment.id).error_code, 'after_cutoff');
});

test('failed delivery and later webhook timestamps cannot evade cost caps', async (t) => {
  const f = fixture(t);
  f.store.updateSettings({ dailyReminderLimit: 1 }, f.now());
  f.add('09:00');
  f.add('10:00');
  f.due();
  await f.runner.tick();
  assert.equal(f.webhook({ statuses: [{ id: 'wamid.test-1', status: 'failed', errors: [{ code: 131026 }] }] }).status, 200);
  await f.runner.tick();
  assert.equal(f.requests.length, 1);
  f.store.db.prepare("UPDATE reminders SET updated_at=? WHERE provider_message_id='wamid.test-1'")
    .run(epoch('2026-11-01', '12:00'));
  assert.equal(f.runner.getStatus().sentThisMonth, 1);
});

test('a zero cost limit pauses outbound automation', async (t) => {
  const f = fixture(t);
  f.store.updateSettings({ dailyReminderLimit: 0 }, f.now());
  f.add();
  f.due();
  await f.runner.tick();
  assert.equal(f.requests.length, 0);
});

test('only explicit 429 rejections retry with backoff, with a maximum of three attempts', async (t) => {
  let calls = 0;
  const f = fixture(t, { fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 130429 } }), { status: 429, headers: { 'Retry-After': '60' } });
  } });
  const appointment = f.add();
  f.due();
  await f.runner.tick();
  assert.equal(f.job(appointment.id).status, 'pending');
  assert.equal(f.job(appointment.id).next_attempt_at, f.now() + 60_000);
  await f.runner.tick();
  assert.equal(calls, 1);
  f.setNow(f.now() + 60_000);
  await f.runner.tick();
  assert.equal(f.job(appointment.id).next_attempt_at, f.now() + 120_000);
  f.setNow(f.now() + 120_000);
  await f.runner.tick();
  await f.runner.tick();
  assert.equal(calls, 3);
  assert.equal(f.job(appointment.id).status, 'failed');
  assert.equal(f.job(appointment.id).error_code, 'RETRY_EXHAUSTED');
});

test('ambiguous API results never retry and reserve potential spend', async (t) => {
  for (const [label, fetchImpl, patch, code] of [
    ['server error', async () => new Response('{}', { status: 503 }), {}, 'HTTP_503'],
    ['connection lost', async () => { throw new Error('socket reset'); }, {}, 'NETWORK_ERROR'],
    ['accepted without ID', async () => new Response('{}', { status: 200 }), {}, 'MISSING_MESSAGE_ID'],
    ['timeout', () => new Promise(() => {}), { timeoutMs: 5 }, 'REQUEST_TIMEOUT'],
  ]) {
    await t.test(label, async (subtest) => {
      let calls = 0;
      const f = fixture(subtest, { fetchImpl: (...args) => { calls += 1; return fetchImpl(...args); }, whatsappPatch: patch });
      f.store.updateSettings({ dailyReminderLimit: 1 }, f.now());
      const appointment = f.add('09:00');
      f.add('10:00');
      f.due();
      await f.runner.tick();
      await f.runner.tick();
      assert.equal(f.job(appointment.id).status, 'needs_review');
      assert.equal(f.job(appointment.id).error_code, code);
      assert.equal(calls, 1);
      assert.equal(f.runner.getStatus().sentThisMonth, 1);
    });
  }
});

test('rejected 4xx requests fail without retry and keep provider error text private', async (t) => {
  const f = fixture(t, { fetchImpl: async () => new Response(JSON.stringify({ error: {
    code: 190, message: 'secret token and phone number must not be copied into the database',
  } }), { status: 401 }) });
  const appointment = f.add();
  f.due();
  await f.runner.tick();
  assert.equal(f.job(appointment.id).status, 'failed');
  assert.equal(f.job(appointment.id).error_code, 'META_190');
  assert.doesNotMatch(f.job(appointment.id).error_text, /secret token/);
});

test('a pending job already associated with Meta cannot be sent again', async (t) => {
  const f = fixture(t);
  const appointment = f.add();
  f.store.db.prepare('UPDATE reminders SET provider_message_id=? WHERE appointment_id=?').run('wamid.existing', appointment.id);
  f.due();
  await f.runner.tick();
  assert.equal(f.requests.length, 0);
  assert.equal(f.job(appointment.id).status, 'needs_review');
});

test('webhook verification requires the correct token and exact raw-body HMAC', (t) => {
  const f = fixture(t);
  const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': whatsapp.verifyToken, 'hub.challenge': '12345' });
  assert.deepEqual(f.runner.handleWebhook({ method: 'GET', query }), {
    status: 200, body: '12345', headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
  query.set('hub.verify_token', 'wrong');
  assert.equal(f.runner.handleWebhook({ method: 'GET', query }).status, 403);
  const rawBody = Buffer.from('{"entry":[]}');
  assert.equal(f.runner.handleWebhook({ method: 'POST', rawBody, signature: `sha256=${'0'.repeat(64)}` }).status, 403);
  const signature = `sha256=${createHmac('sha256', whatsapp.appSecret).update(rawBody).digest('hex')}`;
  assert.equal(f.runner.handleWebhook({ method: 'POST', rawBody: Buffer.from('{ "entry":[]}'), signature }).status, 403);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM webhook_events').get().count, 0);
});

test('delivery webhook transitions are monotonic and replay idempotent', async (t) => {
  const f = fixture(t);
  const appointment = f.add();
  f.due();
  await f.runner.tick();
  const value = { statuses: [{ id: 'wamid.test-1', status: 'read' }] };
  assert.equal(f.webhook(value).status, 200);
  assert.equal(f.webhook(value).status, 200);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM webhook_events').get().count, 1);
  f.webhook({ statuses: [{ id: 'wamid.test-1', status: 'sent' }] });
  f.webhook({ statuses: [{ id: 'wamid.test-1', status: 'delivered' }] });
  f.webhook({ statuses: [{ id: 'wamid.test-1', status: 'failed' }] });
  assert.equal(f.job(appointment.id).status, 'read');
});

test('a webhook arriving before the API response is replayed after the ID is persisted', async (t) => {
  let resolveFetch;
  const f = fixture(t, { fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }) });
  const appointment = f.add();
  f.due();
  const tick = f.runner.tick();
  f.webhook({ statuses: [{ id: 'wamid.race', status: 'read' }] });
  resolveFetch(accepted('wamid.race'));
  await tick;
  assert.equal(f.job(appointment.id).status, 'read');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'whatsapp_status:%'").get().count, 0);
});

test('inbound messages record only the latest interaction and never send a reply', (t) => {
  const f = fixture(t);
  const latest = Math.floor(f.now() / 1000) - 10;
  f.webhook({ messages: [{ from: '393500000001', timestamp: String(latest), text: { body: 'Private client content' } }] });
  f.webhook({ messages: [{ from: '393500000001', timestamp: String(latest - 20) }] });
  const interaction = f.store.db.prepare('SELECT * FROM customer_interactions').get();
  assert.equal(interaction.phone, '+393500000001');
  assert.equal(interaction.last_inbound_at, latest * 1000);
  assert.equal(f.requests.length, 0);
  assert.doesNotMatch(JSON.stringify(interaction), /Private client content/);
});

test('graceful stop waits for the current response and leaves later jobs untouched', async (t) => {
  let resolveFetch;
  let calls = 0;
  const f = fixture(t, { fetchImpl: () => {
    calls += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  } });
  const first = f.add('09:00');
  const second = f.add('10:00');
  f.due();
  const tick = f.runner.tick();
  let stopped = false;
  const stop = f.runner.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  resolveFetch(accepted());
  await Promise.all([tick, stop]);
  assert.equal(f.job(first.id).status, 'accepted');
  assert.equal(f.job(second.id).status, 'pending');
  assert.equal(calls, 1);
});
