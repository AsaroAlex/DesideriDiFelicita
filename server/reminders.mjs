import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { addDays, toLocalParts } from './time.mjs';
import { conservativeReminderCount, effectiveReminderLimits, reminderBlockReason, reminderQuotaPeriod } from './db.mjs';
import { sendAppointmentReminder, whatsappConfiguration } from './whatsapp.mjs';

const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;
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

  const countQuota = (from, to) => conservativeReminderCount(db, from, to);
  const recoveryNeeded = db.prepare(`SELECT id FROM reminders
    WHERE (status='sending' AND (lease_until IS NULL OR lease_until<=?))
      OR (status='pending' AND provider_message_id IS NOT NULL) LIMIT 1`);
  const dueCandidate = db.prepare(`SELECT id FROM reminders WHERE status='pending' AND provider_message_id IS NULL
    AND due_at<=? AND COALESCE(next_attempt_at,due_at)<=? LIMIT 1`);
  const dueRows = db.prepare(`SELECT r.id AS reminder_id, r.appointment_revision, r.attempt_count,
    a.* FROM reminders r JOIN appointments a ON a.id=r.appointment_id
    WHERE r.status='pending' AND r.provider_message_id IS NULL
      AND r.due_at<=? AND COALESCE(r.next_attempt_at,r.due_at)<=?
    ORDER BY r.due_at, a.start_at, r.id LIMIT 100`);

  function getStatus() {
    const whatsapp = getWhatsappConfig();
    const settings = store.getSettings();
    const period = reminderQuotaPeriod(now());
    const limits = effectiveReminderLimits(settings);
    const sentThisMonth = countQuota(period.monthStart, period.monthEnd);
    const sentToday = countQuota(period.dayStart, period.dayEnd);
    return {
      ...whatsappConfiguration(whatsapp),
      enabled: whatsapp.enabled !== false && whatsappConfiguration(whatsapp).configured,
      webhookConfigured: Boolean(whatsapp.appSecret && whatsapp.verifyToken),
      ...limits, sentThisMonth,
      remainingToday: Math.max(0, limits.dailyLimit - sentToday),
      remainingThisMonth: Math.max(0, limits.monthlyLimit - sentThisMonth),
    };
  }

  function audit(event, id, instant, detail = '') {
    db.prepare('INSERT INTO audit_log (event, resource_id, created_at, detail) VALUES (?, ?, ?, ?)')
      .run(event, id, instant, detail);
  }

  function skip(id, reason, instant) {
    const explanation = {
      already_reminded: 'Un promemoria è già stato inviato. Comunica manualmente eventuali cambi di orario.',
      prior_send_uncertain: 'Un precedente invio ha esito incerto. Verifica WhatsApp e comunica manualmente eventuali cambi.',
      manual_sent: 'Promemoria segnato come inviato da Jessica. Nessun altro invio automatico.',
    }[reason] || null;
    db.prepare(`UPDATE reminders SET status='skipped', error_code=?, error_text=?,
      lease_until=NULL, updated_at=? WHERE id=? AND status='pending'`).run(reason, explanation, instant, id);
  }

  function claim() {
    const whatsapp = getWhatsappConfig();
    const instant = now();
    // Paused or empty calendars do not acquire a SQLite writer lock each minute.
    // Only actual stale leases need cleanup, including while automation is paused.
    if (recoveryNeeded.get(instant)) store.transaction(() => {
      // A lease is never returned to pending: after a crash its result is unknown.
      db.prepare(`UPDATE reminders SET status='needs_review', lease_until=NULL,
        error_code='INTERRUPTED_SEND', error_text=?, updated_at=?
        WHERE status='sending' AND (lease_until IS NULL OR lease_until<=?)`)
        .run(STATUS_TEXT.INTERRUPTED_SEND, instant, instant);
      db.prepare(`UPDATE reminders SET status='needs_review', error_code='EXISTING_PROVIDER_ID',
        error_text=?,updated_at=? WHERE status='pending' AND provider_message_id IS NOT NULL`)
        .run('Invio già registrato da Meta: verificare il promemoria.', instant);
    });
    if (whatsapp.enabled === false || !whatsappConfiguration(whatsapp).configured || !dueCandidate.get(instant, instant)) return null;
    return store.transaction(() => {
      const rows = dueRows.all(instant, instant);
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
        const blocked = reminderBlockReason(db, row.id, row.reminder_id);
        if (blocked) { skip(row.reminder_id, blocked, instant); continue; }
        const period = reminderQuotaPeriod(instant);
        const limits = effectiveReminderLimits(store.getSettings());
        if (countQuota(period.dayStart, period.dayEnd) >= limits.dailyLimit
          || countQuota(period.monthStart, period.monthEnd) >= limits.monthlyLimit) return null;
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
