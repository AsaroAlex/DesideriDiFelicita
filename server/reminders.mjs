import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { addDays, localDateTimeToEpoch, toLocalParts } from './time.mjs';
import { sendAppointmentReminder, whatsappConfiguration } from './whatsapp.mjs';

const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;
const SEND_STATUSES = ['sending', 'accepted', 'delivered', 'read', 'needs_review'];
const STATUS_RANK = { pending: 0, sending: 0, needs_review: 0, accepted: 1, failed: 1, delivered: 2, read: 3 };
const STATUS_TEXT = {
  REQUEST_TIMEOUT: 'Esito dell’invio incerto: controllare WhatsApp prima di inviare di nuovo.',
  NETWORK_ERROR: 'Connessione interrotta: controllare WhatsApp prima di inviare di nuovo.',
  MISSING_MESSAGE_ID: 'Meta non ha restituito un identificativo: verificare l’invio.',
  INTERRUPTED_SEND: 'Invio interrotto: controllare WhatsApp prima di inviare di nuovo.',
  RETRY_EXHAUSTED: 'Meta ha rifiutato l’invio per tre tentativi.',
};

function errorText(code, status) {
  return STATUS_TEXT[code] || (status === 'needs_review'
    ? 'Esito dell’invio incerto: controllare WhatsApp prima di inviare di nuovo.'
    : 'Meta ha rifiutato il promemoria. Controllare la configurazione e il numero.');
}

function quotaPeriod(now) {
  const { date } = toLocalParts(now);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const nextMonth = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
  return {
    dayStart: localDateTimeToEpoch(date, '00:00'),
    dayEnd: localDateTimeToEpoch(addDays(date, 1), '00:00'),
    monthStart: localDateTimeToEpoch(`${date.slice(0, 7)}-01`, '00:00'),
    monthEnd: localDateTimeToEpoch(nextMonth, '00:00'),
  };
}

function safePhone(value) {
  const digits = String(value || '').replace(/^\+/, '');
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : null;
}

function queryValue(query, key) {
  return typeof query?.get === 'function' ? query.get(key) : query?.[key];
}

function matchesSecret(value, secret) {
  if (typeof value !== 'string' || typeof secret !== 'string' || !secret) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createReminderRunner({ store, config, getWhatsappConfig = () => config.whatsapp || {}, fetchImpl = fetch, now = Date.now }) {
  const db = store.db;
  let interval;
  let activeTick;
  let stopped = false;

  // Immutable audit timestamps prevent delivery/read callbacks moving a send
  // into another day or month. An uncertain send consumes quota conservatively.
  const countQuota = (from, to) => Number(db.prepare(`
    SELECT COUNT(DISTINCT r.id) AS count
    FROM reminders r JOIN audit_log a ON a.resource_id = r.id
    WHERE a.event = 'whatsapp_send_claimed' AND a.created_at >= ? AND a.created_at < ?
      AND (r.status IN (${SEND_STATUSES.map(() => '?').join(',')}) OR r.provider_message_id IS NOT NULL)
  `).get(from, to, ...SEND_STATUSES).count);

  function getStatus() {
    const whatsapp = getWhatsappConfig();
    const settings = store.getSettings();
    const period = quotaPeriod(now());
    return {
      ...whatsappConfiguration(whatsapp),
      enabled: whatsapp.enabled !== false && whatsappConfiguration(whatsapp).configured,
      webhookConfigured: Boolean(whatsapp.appSecret && whatsapp.verifyToken),
      dailyLimit: settings.dailyReminderLimit ?? 20,
      monthlyLimit: settings.monthlyReminderLimit ?? 200,
      sentThisMonth: countQuota(period.monthStart, period.monthEnd),
    };
  }

  function audit(event, id, instant, detail = '') {
    db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)')
      .run(event, id, instant, detail);
  }

  function skip(id, reason, instant) {
    db.prepare(`UPDATE reminders SET status='skipped', error_code=?, error_text=NULL,
      lease_until=NULL, updated_at=? WHERE id=? AND status='pending'`).run(reason, instant, id);
  }

  function claim() {
    const whatsapp = getWhatsappConfig();
    const instant = now();
    return store.transaction(() => {
      // A lease is never returned to pending: after a crash its result is unknown.
      db.prepare(`UPDATE reminders SET status='needs_review', lease_until=NULL,
        error_code='INTERRUPTED_SEND', error_text=?, updated_at=?
        WHERE status='sending' AND (lease_until IS NULL OR lease_until<=?)`)
        .run(STATUS_TEXT.INTERRUPTED_SEND, instant, instant);
      db.prepare(`UPDATE reminders SET status='needs_review', error_code='EXISTING_PROVIDER_ID',
        error_text=?,updated_at=? WHERE status='pending' AND provider_message_id IS NOT NULL`)
        .run('Invio già registrato da Meta: verificare il promemoria.', instant);
      if (whatsapp.enabled === false || !whatsappConfiguration(whatsapp).configured) return null;
      const rows = db.prepare(`
        SELECT r.id AS reminder_id, r.appointment_revision, r.attempt_count,
          a.* FROM reminders r JOIN appointments a ON a.id=r.appointment_id
        WHERE r.status='pending' AND r.provider_message_id IS NULL
          AND r.due_at<=? AND COALESCE(r.next_attempt_at,r.due_at)<=?
        ORDER BY r.due_at, a.start_at, r.id LIMIT 100
      `).all(instant, instant);
      for (const row of rows) {
        if (row.status !== 'confirmed') { skip(row.reminder_id, 'cancelled', instant); continue; }
        if (!row.reminder_consent) { skip(row.reminder_id, 'no_consent', instant); continue; }
        if (row.revision !== row.appointment_revision) { skip(row.reminder_id, 'rescheduled', instant); continue; }
        if (row.start_at <= instant) { skip(row.reminder_id, 'appointment_past', instant); continue; }
        // Send only on the client's previous local calendar day. Restarting or
        // adding credentials tomorrow must not unleash yesterday's backlog.
        if (toLocalParts(instant).date > addDays(toLocalParts(row.start_at).date, -1)) {
          skip(row.reminder_id, 'after_cutoff', instant); continue;
        }
        if (row.attempt_count >= MAX_ATTEMPTS) { skip(row.reminder_id, 'attempt_limit', instant); continue; }
        const period = quotaPeriod(instant);
        const settings = store.getSettings();
        if (countQuota(period.dayStart, period.dayEnd) >= (settings.dailyReminderLimit ?? 20)
          || countQuota(period.monthStart, period.monthEnd) >= (settings.monthlyReminderLimit ?? 200)) return null;
        const result = db.prepare(`UPDATE reminders SET status='sending', attempt_count=attempt_count+1,
          lease_until=?, updated_at=? WHERE id=? AND status='pending'`)
          .run(instant + LEASE_MS, instant, row.reminder_id);
        if (result.changes !== 1) continue;
        audit('whatsapp_send_claimed', row.reminder_id, instant);
        return { row: { ...row, attempt_count: row.attempt_count + 1 }, whatsapp };
      }
      return null;
    });
  }

  function applyStatus(messageId, status, code, instant) {
    const reminder = db.prepare('SELECT id,status FROM reminders WHERE provider_message_id=?').get(messageId);
    if (!reminder) return false;
    const currentRank = STATUS_RANK[reminder.status] ?? -1;
    const nextRank = STATUS_RANK[status] ?? -1;
    if (nextRank < currentRank || (reminder.status === 'failed' && status === 'accepted')
      || (reminder.status === status)) return true;
    db.prepare('UPDATE reminders SET status=?,error_code=?,error_text=?,updated_at=? WHERE id=?')
      .run(status, status === 'failed' ? code || 'DELIVERY_FAILED' : null,
        status === 'failed' ? 'WhatsApp non ha consegnato il promemoria.' : null, instant, reminder.id);
    return true;
  }

  function finish(row, result) {
    const instant = now();
    store.transaction(() => {
      const current = db.prepare('SELECT status,provider_message_id FROM reminders WHERE id=?').get(row.reminder_id);
      if (!current || current.status !== 'sending') return;
      if (result.status === 'accepted') {
        const existing = db.prepare('SELECT id FROM reminders WHERE provider_message_id=?').get(result.messageId);
        if (existing && existing.id !== row.reminder_id) {
          db.prepare(`UPDATE reminders SET status='needs_review',lease_until=NULL,
            error_code='DUPLICATE_PROVIDER_ID',error_text=?,updated_at=? WHERE id=?`)
            .run('Identificativo Meta già presente: verificare l’invio.', instant, row.reminder_id);
          return;
        }
        db.prepare(`UPDATE reminders SET status='accepted', provider_message_id=?,lease_until=NULL,
          error_code=NULL,error_text=NULL,updated_at=? WHERE id=?`)
          .run(result.messageId, instant, row.reminder_id);
        const pending = db.prepare('SELECT value FROM settings WHERE key=?').get(`whatsapp_status:${result.messageId}`);
        if (pending) {
          const status = JSON.parse(pending.value);
          applyStatus(result.messageId, status.status, status.errorCode, instant);
          db.prepare('DELETE FROM settings WHERE key=?').run(`whatsapp_status:${result.messageId}`);
        }
        audit('whatsapp_send_accepted', row.reminder_id, instant);
        return;
      }
      if (result.status === 'retry' && row.attempt_count < MAX_ATTEMPTS) {
        const backoff = Math.max(result.retryAfterMs || 60_000, Math.min(900_000, 60_000 * 2 ** (row.attempt_count - 1)));
        db.prepare(`UPDATE reminders SET status='pending',next_attempt_at=?,lease_until=NULL,
          error_code=?,error_text=?,updated_at=? WHERE id=?`)
          .run(instant + backoff, result.errorCode, 'Meta ha limitato le richieste. Nuovo tentativo pianificato.', instant, row.reminder_id);
        return;
      }
      const status = result.status === 'retry' ? 'failed' : result.status === 'unconfigured' ? 'needs_review' : result.status;
      const code = result.status === 'retry' ? 'RETRY_EXHAUSTED' : result.errorCode || 'CONFIGURATION_CHANGED';
      db.prepare(`UPDATE reminders SET status=?,lease_until=NULL,error_code=?,error_text=?,updated_at=? WHERE id=?`)
        .run(status, code, errorText(code, status), instant, row.reminder_id);
    });
  }

  async function processTick() {
    let processed = 0;
    for (; processed < 100 && !stopped; processed += 1) {
      const claimed = claim();
      if (!claimed) break;
      const { row, whatsapp } = claimed;
      const result = await sendAppointmentReminder({ whatsapp, appointment: row, fetchImpl, now: now() });
      finish(row, result);
    }
    return { processed };
  }

  function tick() {
    if (activeTick) return Promise.resolve({ processed: 0, busy: true });
    activeTick = processTick().finally(() => { activeTick = undefined; });
    return activeTick;
  }

  function handleWebhook({ method, query, rawBody, signature }) {
    const whatsapp = getWhatsappConfig();
    const failure = (status, code, message) => ({ status, body: { error: { code, message } } });
    if (method === 'GET') {
      const challenge = queryValue(query, 'hub.challenge');
      if (queryValue(query, 'hub.mode') !== 'subscribe'
        || !matchesSecret(queryValue(query, 'hub.verify_token'), whatsapp.verifyToken)
        || typeof challenge !== 'string' || !challenge || challenge.length > 256) {
        return failure(403, 'WEBHOOK_VERIFICATION_FAILED', 'Verifica del webhook non riuscita.');
      }
      return { status: 200, body: challenge, headers: { 'Content-Type': 'text/plain; charset=utf-8' } };
    }
    if (method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED', 'Metodo non consentito.');
    if (!whatsapp.appSecret || !Buffer.isBuffer(rawBody) || !/^sha256=[a-fA-F0-9]{64}$/.test(signature || '')) {
      return failure(403, 'INVALID_SIGNATURE', 'Firma del webhook non valida.');
    }
    const actual = Buffer.from(signature.slice(7), 'hex');
    const expected = createHmac('sha256', whatsapp.appSecret).update(rawBody).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return failure(403, 'INVALID_SIGNATURE', 'Firma del webhook non valida.');
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch {
      return failure(400, 'INVALID_JSON', 'Il webhook deve contenere JSON valido.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return failure(400, 'INVALID_PAYLOAD', 'Formato del webhook non valido.');
    }
    const instant = now();
    const eventHash = createHash('sha256').update(rawBody).digest('hex');
    store.transaction(() => {
      const inserted = db.prepare('INSERT OR IGNORE INTO webhook_events (event_hash,created_at) VALUES (?,?)').run(eventHash, instant);
      if (!inserted.changes) return;
      for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
          const value = change?.value;
          if (!value || (whatsapp.phoneNumberId && value.metadata?.phone_number_id !== whatsapp.phoneNumberId)) continue;
          for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
            const mapped = { sent: 'accepted', delivered: 'delivered', read: 'read', failed: 'failed' }[status?.status];
            if (!mapped || typeof status.id !== 'string' || !status.id || status.id.length > 512) continue;
            const errorCode = Number.isSafeInteger(status.errors?.[0]?.code) ? `META_${status.errors[0].code}` : null;
            if (!applyStatus(status.id, mapped, errorCode, instant)) {
              const key = `whatsapp_status:${status.id}`;
              const old = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
              const previous = old ? JSON.parse(old.value) : null;
              if (!previous || (STATUS_RANK[mapped] > STATUS_RANK[previous.status])
                || (mapped === 'failed' && previous.status === 'accepted')) {
                db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
                  .run(key, JSON.stringify({ status: mapped, errorCode, createdAt: instant }));
              }
            }
          }
          for (const message of Array.isArray(value.messages) ? value.messages : []) {
            const phone = safePhone(message?.from);
            if (!phone) continue;
            const timestamp = Number(message?.timestamp) * 1000;
            const lastInbound = Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, instant) : instant;
            db.prepare(`INSERT INTO customer_interactions (phone,last_inbound_at) VALUES (?,?)
              ON CONFLICT(phone) DO UPDATE SET last_inbound_at=MAX(customer_interactions.last_inbound_at,excluded.last_inbound_at)`)
              .run(phone, lastInbound);
          }
        }
      }
      // Bound replay storage. The approved template remains the only outbound
      // message: inbound interaction never triggers advertising or a reply.
      db.prepare('DELETE FROM webhook_events WHERE created_at<?').run(instant - 30 * 86_400_000);
      db.prepare(`DELETE FROM settings WHERE key LIKE 'whatsapp_status:%'
        AND CAST(json_extract(value,'$.createdAt') AS INTEGER)<?`).run(instant - 86_400_000);
      db.prepare(`DELETE FROM settings WHERE key IN (
        SELECT key FROM settings WHERE key LIKE 'whatsapp_status:%'
        ORDER BY CAST(json_extract(value,'$.createdAt') AS INTEGER) DESC,key DESC LIMIT -1 OFFSET 1000
      )`).run();
    });
    return { status: 200, body: { ok: true } };
  }

  function start() {
    if (interval) return;
    stopped = false;
    const run = () => { tick().catch(() => { console.error('Reminder queue processing failed.'); }); };
    interval = setInterval(run, 60_000);
    interval.unref?.();
    run();
  }

  function stop() {
    stopped = true;
    clearInterval(interval);
    interval = undefined;
    // The HTTP shutdown can await this before closing SQLite. An in-flight API
    // operation is given its bounded timeout instead of being repeated later.
    return activeTick || Promise.resolve();
  }
  return { tick, start, stop, getStatus, handleWebhook };
}
