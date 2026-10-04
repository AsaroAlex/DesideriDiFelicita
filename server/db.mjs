import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { DomainError, fail, requireObject, cleanText, normalizePhone, integer, boolean, duration } from './domain.mjs';
import { TIMEZONE, DAY_NAMES, parseDate, parseTime, toLocalParts, localDateTimeToEpoch, addDays, weekday, minutesToTime, reminderDueAt } from './time.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT NOT NULL, duration_minutes INTEGER, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointments (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, service_id TEXT REFERENCES services(id), title TEXT NOT NULL,
 name TEXT NOT NULL, phone TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at > start_at),
 reminder_consent INTEGER NOT NULL CHECK(reminder_consent IN (0,1)), status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')),
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_start_status ON appointments(status,start_at,end_at);
CREATE INDEX IF NOT EXISTS appointments_phone ON appointments(phone,status,start_at);
CREATE TABLE IF NOT EXISTS reminders (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id), appointment_revision INTEGER NOT NULL,
 due_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sending','accepted','delivered','read','failed','skipped','needs_review')),
 attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER, lease_until INTEGER,
 provider_message_id TEXT UNIQUE, error_code TEXT, error_text TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(appointment_id,appointment_revision)
);
CREATE INDEX IF NOT EXISTS reminders_queue ON reminders(status,next_attempt_at,due_at);
CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES owners(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS customer_interactions (phone TEXT PRIMARY KEY,last_inbound_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (event_hash TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY,event TEXT NOT NULL,resource_id TEXT,created_at INTEGER NOT NULL,detail TEXT);
`;

function serviceId(service, index) {
  if (service.id) return cleanText(service.id, 'Servizio', { max: 80 });
  const slug = service.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `servizio-${index + 1}`;
}

function validateHours(input, baseline) {
  if (!Array.isArray(input) || input.length !== 7) fail('invalid_hours', 'Imposta gli orari per tutti i sette giorni.');
  const used = new Set();
  const validated = input.map((day) => {
    requireObject(day);
    if (!DAY_NAMES.includes(day.day) || used.has(day.day) || !Array.isArray(day.ranges) || day.ranges.length > 4) {
      fail('invalid_hours', 'Gli orari dei giorni non sono validi.');
    }
    used.add(day.day);
    const ranges = day.ranges.map((range) => {
      requireObject(range);
      const opens = parseTime(range.opens).minutes;
      const closes = parseTime(range.closes).minutes;
      if (closes <= opens) fail('invalid_hours', 'L’orario di chiusura deve seguire quello di apertura.');
      return { opens: range.opens, closes: range.closes };
    }).sort((a, b) => a.opens.localeCompare(b.opens));
    for (let i = 1; i < ranges.length; i++) if (ranges[i].opens < ranges[i - 1].closes) fail('invalid_hours', 'Le fasce orarie non possono sovrapporsi.');
    return { day: day.day, label: baseline.find((original) => original.day === day.day)?.label || day.day, ranges };
  });
  return baseline.map((day) => validated.find((entry) => entry.day === day.day));
}

export function createStore({ dataDir, business, now = Date.now }) {
  if (!business || !Array.isArray(business.services) || !Array.isArray(business.openingHours)) throw new Error('Missing business configuration');
  const clock = typeof now === 'function' ? now : () => now;
  const inMemory = dataDir === ':memory:';
  const directory = inMemory ? null : resolve(dataDir || './data');
  if (directory) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(inMemory ? ':memory:' : resolve(directory, 'agenda.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec(SCHEMA);
  let transactionDepth = 0;
  function transaction(fn) {
    if (transactionDepth) return fn();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('SQLite transactions must be synchronous');
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally { transactionDepth--; }
  }
  function setting(key, value) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  const defaults = {
    bookingEnabled: false, reminderTime: '18:00', bookingDays: 60,
    openingHours: validateHours(business.openingHours, business.openingHours), closedDates: [], dailyReminderLimit: 20, monthlyReminderLimit: 200,
  };
  transaction(() => {
    for (const [key, value] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key, JSON.stringify(value));
    business.services.forEach((service, index) => db.prepare('INSERT OR IGNORE INTO services(id,name,duration_minutes,enabled,sort_order) VALUES(?,?,NULL,0,?)').run(serviceId(service, index), service.name, index));
  });
  function getSettings() {
    const result = { ...defaults };
    for (const row of db.prepare('SELECT key,value FROM settings').all()) if (Object.hasOwn(defaults, row.key)) result[row.key] = JSON.parse(row.value);
    return result;
  }
  function mapService(row) { return { id: row.id, name: row.name, durationMinutes: row.duration_minutes, enabled: Boolean(row.enabled), sortOrder: row.sort_order }; }
  function listServices() { return db.prepare('SELECT * FROM services ORDER BY sort_order,id').all().map(mapService); }
  function activeServices() { return listServices().filter((service) => service.enabled && service.durationMinutes !== null); }
  function getPublicConfig(at = clock()) {
    const settings = getSettings();
    return { businessName: business.businessName, timezone: TIMEZONE, bookingEnabled: Boolean(settings.bookingEnabled && activeServices().length), today: toLocalParts(at).date, bookingDays: settings.bookingDays, services: activeServices().map(({ id, name, durationMinutes }) => ({ id, name, durationMinutes })), openingHours: settings.openingHours };
  }
  function getService(id, { publicOnly = false } = {}) {
    if (typeof id !== 'string') fail('invalid_service', 'Scegli un servizio.');
    const row = db.prepare('SELECT * FROM services WHERE id=?').get(id);
    if (!row || (publicOnly && (!row.enabled || row.duration_minutes === null))) fail('invalid_service', 'Questo servizio non è disponibile.', 404);
    return row;
  }
  function publicDate(date, at, settings) {
    parseDate(date);
    const today = toLocalParts(at).date;
    if (date < today || date > addDays(today, settings.bookingDays)) fail('date_out_of_range', 'Scegli una data nel periodo prenotabile.');
  }
  function rangeContains(date, time, durationMinutes, settings) {
    if (settings.closedDates.includes(date)) return false;
    const startMinutes = parseTime(time).minutes;
    const endMinutes = startMinutes + durationMinutes;
    return (settings.openingHours.find((day) => day.day === weekday(date))?.ranges || []).some((range) => startMinutes >= parseTime(range.opens).minutes && endMinutes <= parseTime(range.closes).minutes);
  }
  function conflicts(start, end, exceptId = '') {
    return Boolean(db.prepare("SELECT id FROM appointments WHERE status='confirmed' AND start_at < ? AND end_at > ? AND id <> ? LIMIT 1").get(end, start, exceptId));
  }
  function getAvailability({ serviceId: id, date }, at = clock()) {
    const settings = getSettings();
    if (!settings.bookingEnabled) fail('booking_disabled', 'Le prenotazioni online non sono ancora attive.', 409);
    const service = getService(id, { publicOnly: true });
    publicDate(date, at, settings);
    const slots = [];
    if (settings.closedDates.includes(date)) return { date, serviceId: id, slots };
    const day = settings.openingHours.find((entry) => entry.day === weekday(date));
    const occupied = db.prepare("SELECT start_at,end_at FROM appointments WHERE status='confirmed' AND start_at < ? AND end_at > ?").all(localDateTimeToEpoch(addDays(date, 1), '00:00'), localDateTimeToEpoch(date, '00:00'));
    for (const range of day?.ranges || []) {
      const opens = parseTime(range.opens).minutes;
      const closes = parseTime(range.closes).minutes;
      for (let minute = Math.ceil(opens / 15) * 15; minute + service.duration_minutes <= closes; minute += 15) {
        const time = minutesToTime(minute);
        let startsAt;
        try { startsAt = localDateTimeToEpoch(date, time); } catch (error) { if (error instanceof DomainError && ['invalid_local_time', 'ambiguous_local_time'].includes(error.code)) continue; throw error; }
        const endsAt = startsAt + service.duration_minutes * 60_000;
        const endLocal = toLocalParts(endsAt);
        if (startsAt <= at || endLocal.date !== date || parseTime(endLocal.time).minutes !== minute + service.duration_minutes) continue;
        if (!occupied.some((row) => row.start_at < endsAt && row.end_at > startsAt)) slots.push({ time, label: time, startsAt, endsAt });
      }
    }
    return { date, serviceId: id, slots };
  }
  function mapAppointment(row) {
    const local = toLocalParts(row.start_at);
    return { id: row.id, reference: row.reference, serviceId: row.service_id, title: row.title, name: row.name, phone: row.phone, date: local.date, time: local.time, durationMinutes: (row.end_at - row.start_at) / 60_000, status: row.status, reminderConsent: Boolean(row.reminder_consent), revision: row.revision, createdAt: row.created_at };
  }
  function audit(event, id, at, detail = null) { db.prepare('INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES(?,?,?,?)').run(event, id, at, detail); }
  function planReminder(row, at) {
    if (row.status !== 'confirmed' || !row.reminder_consent) return;
    const dueAt = reminderDueAt(toLocalParts(row.start_at).date, getSettings().reminderTime);
    const late = dueAt <= at || row.start_at <= at;
    db.prepare('INSERT OR IGNORE INTO reminders(id,appointment_id,appointment_revision,due_at,status,next_attempt_at,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), row.id, row.revision, dueAt, late ? 'skipped' : 'pending', dueAt, late ? 'after_cutoff' : null, at, at);
  }
  function invalidateUnsent(id, at, code) {
    db.prepare("UPDATE reminders SET status='skipped',error_code=?,error_text=NULL,lease_until=NULL,updated_at=? WHERE appointment_id=? AND provider_message_id IS NULL AND status IN ('pending','failed')").run(code, at, id);
  }
  function insertAppointment(input, at, publicBooking) {
    requireObject(input);
    const settings = getSettings();
    if (publicBooking && !settings.bookingEnabled) fail('booking_disabled', 'Le prenotazioni online non sono ancora attive.', 409);
    const service = input.serviceId ? getService(input.serviceId, { publicOnly: publicBooking }) : null;
    if (publicBooking && !service) fail('invalid_service', 'Scegli un servizio.');
    const length = duration(publicBooking ? service.duration_minutes : (input.durationMinutes ?? service?.duration_minutes));
    const date = input.date;
    const time = input.time;
    const start = localDateTimeToEpoch(date, time);
    const end = start + length * 60_000;
    const name = cleanText(input.name, 'Nome', { min: 2, max: 100 });
    const phone = normalizePhone(input.phone);
    const consent = boolean(input.reminderConsent, 'Promemoria WhatsApp');
    const title = cleanText(publicBooking ? service.name : (input.title ?? service?.name ?? ''), 'Servizio', { max: 160 });
    if (publicBooking) {
      publicDate(date, at, settings);
      if (start <= at || parseTime(time).minutes % 15 || !rangeContains(date, time, length, settings)) fail('slot_unavailable', 'Questo orario non è disponibile. Scegli un altro orario.', 409);
      const endLocal = toLocalParts(end);
      if (endLocal.date !== date || parseTime(endLocal.time).minutes !== parseTime(time).minutes + length) fail('slot_unavailable', 'Questo orario non è disponibile. Scegli un altro orario.', 409);
      const count = db.prepare("SELECT COUNT(*) AS total FROM appointments WHERE phone=? AND status='confirmed' AND start_at>? ").get(phone, at).total;
      if (count >= 3) fail('booking_limit', 'Per altri appuntamenti contatta direttamente il salone.', 429);
    }
    if (conflicts(start, end)) fail('slot_conflict', 'Questo orario è già occupato. Scegli un altro orario.', 409);
    const row = { id: randomUUID(), reference: `DF-${randomBytes(5).toString('hex').toUpperCase()}`, service_id: service?.id ?? null, title, name, phone, start_at: start, end_at: end, reminder_consent: Number(consent), status: 'confirmed', revision: 1, created_at: at, updated_at: at };
    db.prepare('INSERT INTO appointments(id,reference,service_id,title,name,phone,start_at,end_at,reminder_consent,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
    planReminder(row, at);
    audit(publicBooking ? 'public_booking_created' : 'appointment_created', row.id, at);
    return row;
  }
  function createPublicBooking(input, at = clock()) {
    return transaction(() => {
      const row = insertAppointment(input, at, true);
      const appointment = mapAppointment(row);
      return { id: row.id, reference: row.reference, status: 'confirmed', serviceName: row.title, date: appointment.date, time: appointment.time, durationMinutes: appointment.durationMinutes };
    });
  }
  function createAdminAppointment(input, at = clock()) { return transaction(() => mapAppointment(insertAppointment(input, at, false))); }
  function listAppointments({ from, to } = {}, at = clock()) {
    const today = toLocalParts(at).date;
    from ??= addDays(today, -7);
    to ??= addDays(today, 7);
    parseDate(from); parseDate(to);
    if (from > to || parseDate(to).utc - parseDate(from).utc > 366 * 86_400_000) fail('invalid_range', 'Scegli un intervallo di date valido, fino a un anno.');
    return db.prepare('SELECT * FROM appointments WHERE start_at >= ? AND start_at < ? ORDER BY start_at,id').all(localDateTimeToEpoch(from, '00:00'), localDateTimeToEpoch(addDays(to, 1), '00:00')).map(mapAppointment);
  }
  function updateAppointment(id, patch, at = clock()) {
    requireObject(patch);
    return transaction(() => {
      const row = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
      if (!row) fail('appointment_not_found', 'Appuntamento non trovato.', 404);
      const existing = mapAppointment(row);
      const service = Object.hasOwn(patch, 'serviceId') ? (patch.serviceId ? getService(patch.serviceId) : null) : (row.service_id ? getService(row.service_id) : null);
      const length = duration(patch.durationMinutes ?? existing.durationMinutes);
      const start = localDateTimeToEpoch(patch.date ?? existing.date, patch.time ?? existing.time);
      const end = start + length * 60_000;
      const status = patch.status ?? row.status;
      if (!['confirmed', 'cancelled'].includes(status)) fail('invalid_status', 'Stato appuntamento non valido.');
      const changed = {
        ...row, service_id: service?.id ?? null, title: Object.hasOwn(patch, 'title') ? cleanText(patch.title, 'Servizio', { max: 160 }) : (Object.hasOwn(patch, 'serviceId') && service ? service.name : row.title),
        name: Object.hasOwn(patch, 'name') ? cleanText(patch.name, 'Nome', { min: 2, max: 100 }) : row.name,
        phone: Object.hasOwn(patch, 'phone') ? normalizePhone(patch.phone) : row.phone,
        reminder_consent: Object.hasOwn(patch, 'reminderConsent') ? Number(boolean(patch.reminderConsent, 'Promemoria WhatsApp')) : row.reminder_consent,
        start_at: start, end_at: end, status, updated_at: at,
      };
      if (status === 'confirmed' && conflicts(start, end, id)) fail('slot_conflict', 'Questo orario è già occupato. Scegli un altro orario.', 409);
      const relevant = ['start_at', 'end_at', 'phone', 'reminder_consent', 'status'].some((key) => changed[key] !== row[key]);
      if (relevant) changed.revision++;
      db.prepare('UPDATE appointments SET service_id=?,title=?,name=?,phone=?,start_at=?,end_at=?,reminder_consent=?,status=?,revision=?,updated_at=? WHERE id=?').run(changed.service_id, changed.title, changed.name, changed.phone, start, end, changed.reminder_consent, status, changed.revision, at, id);
      if (relevant) {
        invalidateUnsent(id, at, status === 'cancelled' ? 'appointment_cancelled' : 'appointment_changed');
        planReminder(changed, at);
      }
      audit(status === 'cancelled' ? 'appointment_cancelled' : 'appointment_updated', id, at);
      return mapAppointment(changed);
    });
  }
  function updateService(id, patch, at = clock()) {
    requireObject(patch);
    return transaction(() => {
      const service = getService(id);
      const name = Object.hasOwn(patch, 'name') ? cleanText(patch.name, 'Servizio', { max: 100 }) : service.name;
      const length = Object.hasOwn(patch, 'durationMinutes') ? (patch.durationMinutes === null ? null : duration(patch.durationMinutes)) : service.duration_minutes;
      const enabled = Object.hasOwn(patch, 'enabled') ? boolean(patch.enabled, 'Servizio attivo') : Boolean(service.enabled);
      if (patch.enabled === true && length === null) fail('duration_required', 'Imposta una durata prima di attivare il servizio.');
      db.prepare('UPDATE services SET name=?,duration_minutes=?,enabled=? WHERE id=?').run(name, length, Number(enabled && length !== null), id);
      if (!activeServices().length) setting('bookingEnabled', false);
      audit('service_updated', id, at);
      return mapService(db.prepare('SELECT * FROM services WHERE id=?').get(id));
    });
  }
  function updateSettings(patch, at = clock()) {
    requireObject(patch);
    return transaction(() => {
      const current = getSettings();
      for (const key of Object.keys(patch)) if (!Object.hasOwn(defaults, key)) fail('invalid_setting', 'Impostazione non valida.');
      const next = { ...current, ...patch };
      boolean(next.bookingEnabled, 'Prenotazioni online');
      parseTime(next.reminderTime);
      integer(next.bookingDays, 'Periodo prenotabile', 1, 365);
      integer(next.dailyReminderLimit, 'Limite giornaliero', 0, 1000);
      integer(next.monthlyReminderLimit, 'Limite mensile', 0, 10000);
      next.openingHours = validateHours(next.openingHours, business.openingHours);
      if (!Array.isArray(next.closedDates) || next.closedDates.length > 730) fail('invalid_dates', 'Le date di chiusura non sono valide.');
      next.closedDates.forEach(parseDate);
      next.closedDates = [...new Set(next.closedDates)].sort();
      if (next.bookingEnabled && !activeServices().length) fail('services_not_ready', 'Imposta e attiva almeno un servizio prima di aprire le prenotazioni online.');
      for (const [key, value] of Object.entries(next)) setting(key, value);
      if (current.reminderTime !== next.reminderTime) {
        const jobs = db.prepare("SELECT r.id,r.attempt_count,r.next_attempt_at,a.start_at,a.status,a.reminder_consent FROM reminders r JOIN appointments a ON a.id=r.appointment_id WHERE r.appointment_revision=a.revision AND r.provider_message_id IS NULL AND (r.status='pending' OR (r.status='skipped' AND r.error_code='after_cutoff' AND r.attempt_count=0))").all();
        for (const job of jobs) {
          const due = reminderDueAt(toLocalParts(job.start_at).date, next.reminderTime);
          const late = due <= at || job.start_at <= at || job.status !== 'confirmed' || !job.reminder_consent;
          const nextAttempt = job.attempt_count ? Math.max(due, job.next_attempt_at ?? due) : due;
          db.prepare('UPDATE reminders SET due_at=?,next_attempt_at=?,status=?,error_code=?,error_text=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(due, nextAttempt, late ? 'skipped' : 'pending', late ? 'after_cutoff' : null, at, job.id);
        }
      }
      audit('settings_updated', null, at, JSON.stringify(Object.keys(patch).sort()));
      return next;
    });
  }
  function listReminders({ limit = 100 } = {}) {
    integer(limit, 'Numero promemoria', 1, 500);
    return db.prepare('SELECT r.*,a.name,a.phone,a.start_at FROM reminders r JOIN appointments a ON a.id=r.appointment_id ORDER BY r.due_at DESC,r.id LIMIT ?').all(limit).map((row) => {
      const local = toLocalParts(row.start_at);
      return { id: row.id, appointmentId: row.appointment_id, name: row.name, phone: row.phone, date: local.date, time: local.time, status: row.status, dueAt: row.due_at, attemptCount: row.attempt_count, errorCode: row.error_code, errorText: row.error_text, providerMessageId: row.provider_message_id };
    });
  }
  function getStats(at = clock()) {
    const today = toLocalParts(at).date;
    const start = localDateTimeToEpoch(today, '00:00');
    const end = localDateTimeToEpoch(addDays(today, 1), '00:00');
    const month = localDateTimeToEpoch(`${today.slice(0, 7)}-01`, '00:00');
    return {
      todayAppointments: db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE status='confirmed' AND start_at>=? AND start_at<?").get(start, end).count,
      upcomingAppointments: db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE status='confirmed' AND start_at>? ").get(at).count,
      pendingReminders: db.prepare("SELECT COUNT(*) AS count FROM reminders WHERE status='pending'").get().count,
      sentThisMonth: db.prepare("SELECT COUNT(DISTINCT r.id) AS count FROM reminders r JOIN audit_log a ON a.resource_id=r.id AND a.event='whatsapp_send_claimed' WHERE (r.status IN ('accepted','delivered','read') OR r.provider_message_id IS NOT NULL) AND a.created_at>=? AND a.created_at<=?").get(month, at).count,
    };
  }
  async function backup() {
    if (!directory) return null;
    const backupDirectory = resolve(directory, 'backups');
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const destination = resolve(backupDirectory, `agenda-${toLocalParts(clock()).date}.sqlite`);
    const temporary = resolve(backupDirectory, `.agenda-${randomUUID()}.tmp`);
    const { readdir, unlink, rename, chmod } = await import('node:fs/promises');
    try {
      await sqliteBackup(db, temporary);
      // The live database uses WAL. A backup is a standalone snapshot that
      // must remain readable without sidecar files or access to the live WAL.
      const snapshot = new DatabaseSync(temporary);
      try { snapshot.exec('PRAGMA journal_mode=DELETE'); } finally { snapshot.close(); }
      await chmod(temporary, 0o600);
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      await unlink(`${temporary}-wal`).catch(() => {});
      await unlink(`${temporary}-shm`).catch(() => {});
      throw error;
    }
    const copies = (await readdir(backupDirectory)).filter((file) => /^agenda-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)).sort().reverse();
    await Promise.all(copies.slice(7).map((file) => unlink(resolve(backupDirectory, file))));
    return destination;
  }
  return { db, transaction, close: () => db.close(), getPublicConfig, getAvailability, createPublicBooking, listAppointments, createAdminAppointment, updateAppointment, listServices, updateService, getSettings, updateSettings, listReminders, getStats, backup };
}
