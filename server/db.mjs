import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { DomainError, fail, requireObject, cleanText, normalizePhone, integer, boolean, duration } from './domain.mjs';
import { TIMEZONE, DAY_NAMES, parseDate, parseTime, toLocalParts, localDateTimeToEpoch, addDays, weekday, minutesToTime, reminderDueAt } from './time.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT NOT NULL, duration_minutes INTEGER, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0, listed INTEGER NOT NULL DEFAULT 1 CHECK(listed IN (0,1)));
CREATE TABLE IF NOT EXISTS appointments (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, service_id TEXT REFERENCES services(id), title TEXT NOT NULL,
 name TEXT NOT NULL, phone TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at > start_at),
 reminder_consent INTEGER NOT NULL CHECK(reminder_consent IN (0,1)), status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')),
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_start_status ON appointments(status,start_at,end_at);
CREATE INDEX IF NOT EXISTS appointments_phone ON appointments(phone,status,start_at);
CREATE TABLE IF NOT EXISTS booking_requests (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, client_request_id TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
 service_id TEXT NOT NULL REFERENCES services(id), name TEXT NOT NULL, phone TEXT NOT NULL, requested_start_at INTEGER NOT NULL,
 reminder_consent INTEGER NOT NULL CHECK(reminder_consent IN (0,1)), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','declined')),
 appointment_id TEXT REFERENCES appointments(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((status='confirmed' AND appointment_id IS NOT NULL) OR (status IN ('pending','declined') AND appointment_id IS NULL))
);
CREATE INDEX IF NOT EXISTS booking_requests_status_start ON booking_requests(status,requested_start_at);
CREATE INDEX IF NOT EXISTS booking_requests_phone ON booking_requests(phone,status,requested_start_at);
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
CREATE INDEX IF NOT EXISTS audit_log_event_resource_time ON audit_log(event,resource_id,created_at);
CREATE TABLE IF NOT EXISTS calendar_blocks (id TEXT PRIMARY KEY,title TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL CHECK(end_at>start_at),created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS calendar_blocks_interval ON calendar_blocks(start_at,end_at);
CREATE TABLE IF NOT EXISTS customer_profiles (phone TEXT PRIMARY KEY,notes TEXT NOT NULL,updated_at INTEGER NOT NULL,version INTEGER NOT NULL CHECK(version>0));
CREATE TABLE IF NOT EXISTS booking_idempotency (client_request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,appointment_id TEXT NOT NULL REFERENCES appointments(id));
`;

export function noteText(value = '', maximum = 500) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('invalid_notes', `Usa un testo di massimo ${maximum} caratteri.`);
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (normalized.length > maximum) fail('invalid_notes', `Usa un testo di massimo ${maximum} caratteri.`);
  return normalized;
}

const QUOTA_STATUSES = ['sending', 'accepted', 'delivered', 'read', 'needs_review'];
const quotaStatements = new WeakMap();
const blockStatements = new WeakMap();

export function effectiveReminderLimits(settings) {
  const economyMode = settings.economyMode !== false;
  const configuredDailyLimit = settings.dailyReminderLimit ?? 20;
  const configuredMonthlyLimit = settings.monthlyReminderLimit ?? 200;
  return {
    economyMode, configuredDailyLimit, configuredMonthlyLimit,
    dailyLimit: economyMode ? Math.min(configuredDailyLimit, 10) : configuredDailyLimit,
    monthlyLimit: economyMode ? Math.min(configuredMonthlyLimit, 60) : configuredMonthlyLimit,
  };
}

export function reminderQuotaPeriod(instant) {
  const { date } = toLocalParts(instant);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const nextMonth = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
  return {
    dayStart: localDateTimeToEpoch(date, '00:00'), dayEnd: localDateTimeToEpoch(addDays(date, 1), '00:00'),
    monthStart: localDateTimeToEpoch(`${date.slice(0, 7)}-01`, '00:00'), monthEnd: localDateTimeToEpoch(nextMonth, '00:00'),
  };
}

export function conservativeReminderCount(db, from, to) {
  let statement = quotaStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT COUNT(DISTINCT r.id) AS count FROM reminders r JOIN audit_log a ON a.resource_id=r.id
      WHERE a.event='whatsapp_send_claimed' AND a.created_at>=? AND a.created_at<?
      AND (r.status IN (${QUOTA_STATUSES.map(() => '?').join(',')}) OR r.provider_message_id IS NOT NULL)`);
    quotaStatements.set(db, statement);
  }
  return Number(statement.get(from, to, ...QUOTA_STATUSES).count);
}

export function reminderBlockReason(db, appointmentId, exceptId = '') {
  let statements = blockStatements.get(db);
  if (!statements) {
    statements = {
      manual: db.prepare("SELECT id FROM audit_log WHERE event='reminder_marked_manual' AND resource_id=? LIMIT 1"),
      previous: db.prepare(`SELECT status,provider_message_id FROM reminders WHERE appointment_id=? AND id<>?
        AND (provider_message_id IS NOT NULL OR status IN ('sending','accepted','delivered','read','needs_review'))
        ORDER BY (provider_message_id IS NOT NULL) DESC,id LIMIT 1`),
    };
    blockStatements.set(db, statements);
  }
  if (statements.manual.get(appointmentId)) return 'manual_sent';
  const previous = statements.previous.get(appointmentId, exceptId);
  if (!previous) return null;
  return !previous.provider_message_id && ['sending', 'needs_review'].includes(previous.status) ? 'prior_send_uncertain' : 'already_reminded';
}

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
  let customerAccessSync;
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
    bookingEnabled: false, requestEnabled: true, reminderTime: '18:00', bookingDays: 60, economyMode: true,
    bookingLeadMinutes: 0, customerChangesEnabled: true, customerChangeNoticeHours: 0,
    openingHours: validateHours(business.openingHours, business.openingHours), closedDates: [], dailyReminderLimit: 20, monthlyReminderLimit: 200,
  };
  const settingsKeys = Object.keys(defaults);
  const settingsQuery = db.prepare(`SELECT key,value FROM settings WHERE key IN (${settingsKeys.map(() => '?').join(',')})`);
  transaction(() => {
    // Existing calendars keep their catalog and history. Run the additive
    // migration under the same write lock as seeding so parallel starts do not
    // race to add the column or reset a service archived by its owner.
    if (!db.prepare('PRAGMA table_info(services)').all().some((column) => column.name === 'listed')) {
      db.exec('ALTER TABLE services ADD COLUMN listed INTEGER NOT NULL DEFAULT 1 CHECK(listed IN (0,1))');
    }
    const addColumns = (table, definitions) => {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      for (const [name, definition] of Object.entries(definitions)) if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      return columns;
    };
    const originalServiceColumns = addColumns('services', { description: "TEXT NOT NULL DEFAULT ''", price_cents: 'INTEGER', price_from: 'INTEGER NOT NULL DEFAULT 0 CHECK(price_from IN(0,1))', buffer_after_minutes: 'INTEGER NOT NULL DEFAULT 0 CHECK(buffer_after_minutes BETWEEN 0 AND 120)' });
    addColumns('appointments', { notes: "TEXT NOT NULL DEFAULT ''", outcome: "TEXT NOT NULL DEFAULT 'scheduled' CHECK(outcome IN('scheduled','completed','no_show'))", buffer_after_minutes: 'INTEGER NOT NULL DEFAULT 0 CHECK(buffer_after_minutes BETWEEN 0 AND 120)', phone_normalized: 'TEXT' });
    addColumns('booking_requests', { notes: "TEXT NOT NULL DEFAULT ''", withdrawn_at: 'INTEGER', phone_normalized: 'TEXT' });
    for (const table of ['appointments', 'booking_requests']) {
      const update = db.prepare(`UPDATE ${table} SET phone_normalized=? WHERE id=?`);
      for (const row of db.prepare(`SELECT id,phone FROM ${table} WHERE phone_normalized IS NULL`).all()) {
        try { update.run(normalizePhone(row.phone), row.id); } catch (error) { if (!(error instanceof DomainError) || error.code !== 'invalid_phone') throw error; }
      }
    }
    db.exec('CREATE INDEX IF NOT EXISTS appointments_customer_history ON appointments(phone_normalized,start_at DESC); CREATE INDEX IF NOT EXISTS requests_customer_history ON booking_requests(phone_normalized,requested_start_at DESC);');
    for (const [key, value] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key, JSON.stringify(value));
    business.services.forEach((service, index) => db.prepare('INSERT OR IGNORE INTO services(id,name,duration_minutes,enabled,sort_order,description) VALUES(?,?,NULL,0,?,?)').run(serviceId(service, index), service.name, index, noteText(service.description || '', 1000)));
    if (!originalServiceColumns.has('description')) for (const [index, service] of business.services.entries()) db.prepare('UPDATE services SET description=? WHERE id=?').run(noteText(service.description || '', 1000), serviceId(service, index));
  });
  function getSettings() {
    const result = { ...defaults };
    for (const row of settingsQuery.all(...settingsKeys)) result[row.key] = JSON.parse(row.value);
    return result;
  }
  function mapService(row) { return { id: row.id, name: row.name, description: row.description, durationMinutes: row.duration_minutes, enabled: Boolean(row.enabled), listed: Boolean(row.listed), sortOrder: row.sort_order, priceCents: row.price_cents, priceFrom: Boolean(row.price_from), bufferAfterMinutes: row.buffer_after_minutes }; }
  function publicService(service) { const { id, name, description, durationMinutes, priceCents, priceFrom, bufferAfterMinutes, listed } = service; return { id, name, description, durationMinutes, priceCents, priceFrom, bufferAfterMinutes, listed }; }
  function listServices() { return db.prepare('SELECT * FROM services ORDER BY sort_order,id').all().map(mapService); }
  function activeServices() { return listServices().filter((service) => service.listed && service.enabled && service.durationMinutes !== null); }
  function getPublicConfig(at = clock()) {
    const settings = getSettings();
    return {
      businessName: business.businessName, timezone: TIMEZONE, bookingEnabled: Boolean(settings.bookingEnabled && activeServices().length),
      requestEnabled: settings.requestEnabled, today: toLocalParts(at).date, bookingDays: settings.bookingDays,
      catalog: listServices().filter((service) => service.listed).map(publicService),
      services: activeServices().map(publicService),
      requestServices: settings.requestEnabled ? listServices().filter((service) => service.listed).map((service) => ({ ...publicService(service), instantBooking: Boolean(settings.bookingEnabled && service.enabled && service.durationMinutes !== null) })) : [],
      openingHours: settings.openingHours, closedDates: settings.closedDates,
      bookingLeadMinutes: settings.bookingLeadMinutes, customerChangesEnabled: settings.customerChangesEnabled, customerChangeNoticeHours: settings.customerChangeNoticeHours,
    };
  }
  function getService(id, { publicOnly = false, listedOnly = false } = {}) {
    if (typeof id !== 'string') fail('invalid_service', 'Scegli un servizio.');
    const row = db.prepare('SELECT * FROM services WHERE id=?').get(id);
    if (!row || ((publicOnly || listedOnly) && !row.listed) || (publicOnly && (!row.enabled || row.duration_minutes === null))) fail('invalid_service', 'Questo servizio non è disponibile.', 404);
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
    return Boolean(db.prepare("SELECT id FROM appointments WHERE status='confirmed' AND start_at < ? AND end_at+buffer_after_minutes*60000 > ? AND id <> ? LIMIT 1").get(end, start, exceptId)) || Boolean(db.prepare('SELECT id FROM calendar_blocks WHERE start_at<? AND end_at>? LIMIT 1').get(end, start));
  }
  function occupiedBetween(start, end, exceptId = '') {
    return [...db.prepare("SELECT start_at,end_at+buffer_after_minutes*60000 AS end_at FROM appointments WHERE status='confirmed' AND start_at<? AND end_at+buffer_after_minutes*60000>? AND id<>?").all(end, start, exceptId), ...db.prepare('SELECT start_at,end_at FROM calendar_blocks WHERE start_at<? AND end_at>?').all(end, start)];
  }
  function getAvailability({ serviceId: id, date }, at = clock()) {
    const settings = getSettings();
    if (!settings.bookingEnabled) fail('booking_disabled', 'Le prenotazioni online non sono ancora attive.', 409);
    const service = getService(id, { publicOnly: true });
    publicDate(date, at, settings);
    const slots = [];
    if (settings.closedDates.includes(date)) return { date, serviceId: id, slots };
    const day = settings.openingHours.find((entry) => entry.day === weekday(date));
    const occupied = occupiedBetween(localDateTimeToEpoch(date, '00:00'), localDateTimeToEpoch(addDays(date, 1), '00:00'));
    for (const range of day?.ranges || []) {
      const opens = parseTime(range.opens).minutes;
      const closes = parseTime(range.closes).minutes;
      for (let minute = Math.ceil(opens / 15) * 15; minute + service.duration_minutes + service.buffer_after_minutes <= closes; minute += 15) {
        const time = minutesToTime(minute);
        let startsAt;
        try { startsAt = localDateTimeToEpoch(date, time); } catch (error) { if (error instanceof DomainError && ['invalid_local_time', 'ambiguous_local_time'].includes(error.code)) continue; throw error; }
        const endsAt = startsAt + service.duration_minutes * 60_000;
        const endLocal = toLocalParts(endsAt + service.buffer_after_minutes * 60_000);
        if (startsAt <= at || startsAt < at + settings.bookingLeadMinutes * 60_000 || endLocal.date !== date || parseTime(endLocal.time).minutes !== minute + service.duration_minutes + service.buffer_after_minutes) continue;
        if (!occupied.some((row) => row.start_at < endsAt + service.buffer_after_minutes * 60_000 && row.end_at > startsAt)) slots.push({ time, label: time, startsAt, endsAt });
      }
    }
    return { date, serviceId: id, slots };
  }
  function getRequestAvailability({ serviceId: id, date }, at = clock()) {
    const settings = getSettings();
    if (!settings.requestEnabled) fail('request_disabled', 'Le richieste dal calendario sono momentaneamente sospese.', 409);
    getService(id, { listedOnly: true });
    publicDate(date, at, settings);
    const slots = [];
    if (settings.closedDates.includes(date)) return { mode: 'request', date, serviceId: id, slots };
    const day = settings.openingHours.find((entry) => entry.day === weekday(date));
    const occupied = occupiedBetween(localDateTimeToEpoch(date, '00:00'), localDateTimeToEpoch(addDays(date, 1), '00:00'));
    for (const range of day?.ranges || []) {
      const closes = parseTime(range.closes).minutes;
      for (let minute = Math.ceil(parseTime(range.opens).minutes / 15) * 15; minute < closes; minute += 15) {
        const time = minutesToTime(minute);
        let startsAt;
        try { startsAt = localDateTimeToEpoch(date, time); } catch (error) { if (error instanceof DomainError && ['invalid_local_time', 'ambiguous_local_time'].includes(error.code)) continue; throw error; }
        if (startsAt <= at || startsAt < at + settings.bookingLeadMinutes * 60_000 || occupied.some((row) => row.start_at <= startsAt && row.end_at > startsAt)) continue;
        slots.push({ time, label: time, startsAt, endsAt: null });
      }
    }
    return { mode: 'request', date, serviceId: id, slots };
  }
  function slotsRange({ serviceId, from, days = 14, mode, length, buffer = 0, exceptId = '' }, at) {
    integer(days, 'Numero giorni', 1, 14);
    const settings = getSettings();
    publicDate(from, at, settings);
    const last = addDays(toLocalParts(at).date, settings.bookingDays);
    const count = Math.min(days, (parseDate(last).utc - parseDate(from).utc) / 86_400_000 + 1);
    const occupied = occupiedBetween(localDateTimeToEpoch(from, '00:00'), localDateTimeToEpoch(addDays(from, count), '00:00'), exceptId);
    const dates = [];
    for (let offset = 0; offset < count; offset++) {
      const date = addDays(from, offset);
      const slots = [];
      const ranges = settings.closedDates.includes(date) ? [] : settings.openingHours.find((entry) => entry.day === weekday(date))?.ranges || [];
      for (const range of ranges) for (let minute = Math.ceil(parseTime(range.opens).minutes / 15) * 15; mode === 'request' ? minute < parseTime(range.closes).minutes : minute + length + buffer <= parseTime(range.closes).minutes; minute += 15) {
        const time = minutesToTime(minute);
        let startsAt;
        try { startsAt = localDateTimeToEpoch(date, time); } catch (error) { if (error instanceof DomainError && ['invalid_local_time', 'ambiguous_local_time'].includes(error.code)) continue; throw error; }
        if (startsAt <= at || startsAt < at + settings.bookingLeadMinutes * 60_000) continue;
        const endsAt = mode === 'request' ? null : startsAt + length * 60_000;
        const occupiedEnd = endsAt === null ? startsAt + 1 : endsAt + buffer * 60_000;
        if (endsAt !== null) {
          const endLocal = toLocalParts(occupiedEnd);
          if (endLocal.date !== date || parseTime(endLocal.time).minutes !== minute + length + buffer) continue;
        }
        if (!occupied.some((row) => row.start_at < occupiedEnd && row.end_at > startsAt)) slots.push({ time, label: time, startsAt, endsAt });
      }
      dates.push({ date, slots });
    }
    return { serviceId, mode, days: dates };
  }
  function getAvailabilityRange({ serviceId: id, from, days = 14 }, at = clock()) {
    const service = getService(id, { listedOnly: true });
    const settings = getSettings();
    const mode = settings.bookingEnabled && service.enabled && service.duration_minutes !== null ? 'instant' : 'request';
    if (mode === 'request' && !settings.requestEnabled) fail('request_disabled', 'Le richieste dal calendario sono momentaneamente sospese.', 409);
    return slotsRange({ serviceId: id, from, days, mode, length: service.duration_minutes, buffer: service.buffer_after_minutes }, at);
  }
  function getAppointmentAvailability({ id, from, days = 14 }, at = clock()) {
    const appointment = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
    if (!appointment || appointment.status !== 'confirmed' || appointment.outcome !== 'scheduled') fail('appointment_not_active', 'Questo appuntamento non è modificabile.', 409);
    return slotsRange({ serviceId: appointment.service_id, from, days, mode: 'instant', length: (appointment.end_at - appointment.start_at) / 60_000, buffer: appointment.buffer_after_minutes, exceptId: appointment.id }, at);
  }
  function calendarRange({ from, to } = {}, at = clock()) {
    const today = toLocalParts(at).date;
    from ??= addDays(today, -7); to ??= addDays(today, 7);
    parseDate(from); parseDate(to);
    if (from > to || parseDate(to).utc - parseDate(from).utc > 366 * 86_400_000) fail('invalid_range', 'Scegli un intervallo di massimo un anno.');
    return { startsAt: localDateTimeToEpoch(from, '00:00'), endsAt: localDateTimeToEpoch(addDays(to, 1), '00:00') };
  }
  function mapBlock(row) {
    const local = toLocalParts(row.start_at);
    return { id: row.id, title: row.title, date: local.date, time: local.time, durationMinutes: (row.end_at - row.start_at) / 60_000, startsAt: row.start_at, endsAt: row.end_at };
  }
  function listBlocks(range = {}, at = clock()) {
    const { startsAt, endsAt } = calendarRange(range, at);
    return db.prepare('SELECT * FROM calendar_blocks WHERE start_at<? AND end_at>? ORDER BY start_at,id').all(endsAt, startsAt).map(mapBlock);
  }
  function createBlock(input, at = clock()) {
    requireObject(input);
    const title = cleanText(input.title, 'Nome della pausa', { max: 100 });
    const start = localDateTimeToEpoch(input.date, input.time);
    const end = start + integer(input.durationMinutes, 'Durata della pausa', 1, 10080) * 60_000;
    toLocalParts(end);
    return transaction(() => {
      if (conflicts(start, end)) fail('slot_conflict', 'La pausa si sovrappone a un appuntamento o a un’altra pausa.', 409);
      const row = { id: randomUUID(), title, start_at: start, end_at: end, created_at: at };
      db.prepare('INSERT INTO calendar_blocks(id,title,start_at,end_at,created_at) VALUES(?,?,?,?,?)').run(...Object.values(row));
      audit('calendar_block_created', row.id, at);
      return mapBlock(row);
    });
  }
  function deleteBlock(id, at = clock()) {
    return transaction(() => {
      const deleted = db.prepare('DELETE FROM calendar_blocks WHERE id=?').run(id);
      if (deleted.changes) audit('calendar_block_removed', id, at);
      return { ok: true };
    });
  }
  function mapAppointment(row) {
    const local = toLocalParts(row.start_at);
    return { id: row.id, reference: row.reference, serviceId: row.service_id, title: row.title, name: row.name, phone: row.phone, date: local.date, time: local.time, startsAt: row.start_at, endsAt: row.end_at, durationMinutes: (row.end_at - row.start_at) / 60_000, bufferAfterMinutes: row.buffer_after_minutes, status: row.status, outcome: row.outcome, notes: row.notes, reminderConsent: Boolean(row.reminder_consent), revision: row.revision, createdAt: row.created_at };
  }
  function audit(event, id, at, detail = null) { db.prepare('INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES(?,?,?,?)').run(event, id, at, detail); }
  function upcomingCustomerCount(phone, at) {
    return db.prepare("SELECT (SELECT COUNT(*) FROM appointments WHERE phone=? AND status='confirmed' AND start_at>?) + (SELECT COUNT(*) FROM booking_requests WHERE phone=? AND status='pending' AND requested_start_at>?) AS total").get(phone, at, phone, at).total;
  }
  function mapRequest(row) {
    const local = toLocalParts(row.requested_start_at);
    const service = getService(row.service_id);
    const appointment = row.appointment_id ? db.prepare('SELECT * FROM appointments WHERE id=?').get(row.appointment_id) : null;
    return {
      id: row.id, reference: row.reference, serviceId: row.service_id, serviceName: service.name, name: row.name, phone: row.phone,
      date: local.date, time: local.time, reminderConsent: Boolean(row.reminder_consent), status: row.status, withdrawnAt: row.withdrawn_at, notes: row.notes, appointmentId: row.appointment_id,
      appointment: appointment ? mapAppointment(appointment) : null, createdAt: row.created_at,
    };
  }
  function publicRequestReceipt(row) {
    if (row.status === 'confirmed') {
      const appointment = db.prepare('SELECT * FROM appointments WHERE id=?').get(row.appointment_id);
      const local = toLocalParts(appointment.start_at);
      return { id: row.id, reference: row.reference, status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed', serviceName: appointment.title, date: local.date, time: local.time, durationMinutes: (appointment.end_at - appointment.start_at) / 60_000 };
    }
    const local = toLocalParts(row.requested_start_at);
    return { id: row.id, reference: row.reference, status: row.withdrawn_at ? 'withdrawn' : row.status, serviceName: getService(row.service_id).name, date: local.date, time: local.time };
  }
  function createPublicRequest(input, at = clock()) {
    requireObject(input);
    // A UUID belongs to one normalized payload forever, including after the
    // request is confirmed or declined. Retrying never inserts another row.
    if (typeof input.clientRequestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientRequestId)) {
      fail('invalid_request_id', 'Riprova a inviare la richiesta dal calendario.');
    }
    const clientRequestId = input.clientRequestId.toLowerCase();
    const name = cleanText(input.name, 'Nome', { min: 2, max: 100 });
    const phone = normalizePhone(input.phone);
    const reminderConsent = boolean(input.reminderConsent, 'Promemoria WhatsApp');
    const notes = noteText(input.notes);
    const service = getService(input.serviceId);
    const startsAt = localDateTimeToEpoch(input.date, input.time);
    const payloadHash = createHash('sha256').update(JSON.stringify({ serviceId: service.id, date: input.date, time: input.time, name, phone, reminderConsent, notes })).digest('hex');
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM booking_requests WHERE client_request_id=?').get(clientRequestId);
      if (previous) {
        const legacyHash = !notes && !previous.notes ? createHash('sha256').update(JSON.stringify({ serviceId: service.id, date: input.date, time: input.time, name, phone, reminderConsent })).digest('hex') : null;
        if (previous.payload_hash !== payloadHash && previous.payload_hash !== legacyHash) fail('request_id_reused', 'La richiesta è stata modificata. Invia una nuova richiesta dal calendario.', 409);
        return publicRequestReceipt(previous);
      }
      const slots = getRequestAvailability({ serviceId: service.id, date: input.date }, at).slots;
      if (!slots.some((slot) => slot.startsAt === startsAt)) fail('request_unavailable', 'Questo orario non è più selezionabile. Scegli un altro orario.', 409);
      if (upcomingCustomerCount(phone, at) >= 3) fail('booking_limit', 'Per altri appuntamenti contatta direttamente il salone.', 429);
      const row = {
        id: randomUUID(), reference: `DR-${randomBytes(5).toString('hex').toUpperCase()}`, client_request_id: clientRequestId, payload_hash: payloadHash,
        service_id: service.id, name, phone, requested_start_at: startsAt, reminder_consent: Number(reminderConsent), status: 'pending',
        appointment_id: null, created_at: at, updated_at: at,
      };
      db.prepare('INSERT INTO booking_requests(id,reference,client_request_id,payload_hash,service_id,name,phone,requested_start_at,reminder_consent,status,appointment_id,created_at,updated_at,notes,phone_normalized) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row), notes, phone);
      audit('public_request_created', row.id, at);
      return publicRequestReceipt(row);
    });
  }
  function listRequests({ status = 'pending', limit = 100 } = {}) {
    if (!['pending', 'confirmed', 'declined'].includes(status)) fail('invalid_status', 'Stato richiesta non valido.');
    integer(limit, 'Numero richieste', 1, 500);
    return db.prepare('SELECT * FROM booking_requests WHERE status=? ORDER BY requested_start_at,created_at,id LIMIT ?').all(status, limit).map(mapRequest);
  }
  function getRequest(id) {
    if (typeof id !== 'string') fail('request_not_found', 'Richiesta non trovata.', 404);
    const row = db.prepare('SELECT * FROM booking_requests WHERE id=?').get(id);
    if (!row) fail('request_not_found', 'Richiesta non trovata.', 404);
    return row;
  }
  function confirmRequest(id, input = {}, at = clock()) {
    requireObject(input);
    return transaction(() => {
      const row = getRequest(id);
      if (row.status === 'confirmed') {
        const request = mapRequest(row);
        return { request, appointment: request.appointment };
      }
      if (row.status !== 'pending') fail('request_not_pending', 'Questa richiesta è già stata rifiutata.', 409);
      const service = getService(row.service_id);
      const requestedLocal = toLocalParts(row.requested_start_at);
      const date = input.date ?? requestedLocal.date;
      const time = input.time ?? requestedLocal.time;
      const length = duration(Object.hasOwn(input, 'durationMinutes') ? input.durationMinutes : service.duration_minutes);
      const settings = getSettings();
      publicDate(date, at, settings);
      const start = localDateTimeToEpoch(date, time);
      const endLocal = toLocalParts(start + (length + service.buffer_after_minutes) * 60_000);
      if (start <= at || !rangeContains(date, time, length + service.buffer_after_minutes, settings) || endLocal.date !== date || parseTime(endLocal.time).minutes !== parseTime(time).minutes + length + service.buffer_after_minutes) {
        fail('slot_unavailable', 'La durata dell’appuntamento deve rientrare negli orari di apertura. Scegli un altro orario.', 409);
      }
      // This nested insert shares the outer BEGIN IMMEDIATE transaction: no
      // other connection can occupy the interval between the check and link.
      const appointment = createAdminAppointment({ serviceId: service.id, date, time, durationMinutes: length, name: row.name, phone: row.phone, reminderConsent: Boolean(row.reminder_consent), notes: row.notes }, at);
      db.prepare("UPDATE booking_requests SET status='confirmed',appointment_id=?,updated_at=? WHERE id=?").run(appointment.id, at, row.id);
      customerAccessSync?.(appointment.id);
      audit('request_confirmed', row.id, at);
      return { request: mapRequest(getRequest(id)), appointment };
    });
  }
  function declineRequest(id, at = clock()) {
    return transaction(() => {
      const row = getRequest(id);
      if (row.status === 'declined') return mapRequest(row);
      if (row.status !== 'pending') fail('request_not_pending', 'Questa richiesta è già stata confermata. Per annullarla modifica l’appuntamento in agenda.', 409);
      db.prepare("UPDATE booking_requests SET status='declined',updated_at=? WHERE id=?").run(at, row.id);
      audit('request_declined', row.id, at);
      return mapRequest(getRequest(id));
    });
  }
  function planReminder(row, at) {
    if (row.status !== 'confirmed' || !row.reminder_consent) return;
    const dueAt = reminderDueAt(toLocalParts(row.start_at).date, getSettings().reminderTime);
    const late = dueAt <= at || row.start_at <= at;
    const blocked = reminderBlockReason(db, row.id);
    db.prepare('INSERT OR IGNORE INTO reminders(id,appointment_id,appointment_revision,due_at,status,next_attempt_at,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), row.id, row.revision, dueAt, late || blocked ? 'skipped' : 'pending', dueAt, blocked || (late ? 'after_cutoff' : null), at, at);
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
    const notes = noteText(input.notes);
    const buffer = service?.buffer_after_minutes ?? 0;
    const title = cleanText(publicBooking ? service.name : (input.title ?? service?.name ?? ''), 'Servizio', { max: 160 });
    if (publicBooking) {
      publicDate(date, at, settings);
      if (start <= at || start < at + settings.bookingLeadMinutes * 60_000 || parseTime(time).minutes % 15 || !rangeContains(date, time, length + buffer, settings)) fail('slot_unavailable', 'Questo orario non è disponibile. Scegli un altro orario.', 409);
      const endLocal = toLocalParts(end + buffer * 60_000);
      if (endLocal.date !== date || parseTime(endLocal.time).minutes !== parseTime(time).minutes + length + buffer) fail('slot_unavailable', 'Questo orario non è disponibile. Scegli un altro orario.', 409);
      const count = upcomingCustomerCount(phone, at);
      if (count >= 3) fail('booking_limit', 'Per altri appuntamenti contatta direttamente il salone.', 429);
    }
    if (conflicts(start, end + buffer * 60_000)) fail('slot_conflict', 'Questo orario è già occupato. Scegli un altro orario.', 409);
    const row = { id: randomUUID(), reference: `DF-${randomBytes(5).toString('hex').toUpperCase()}`, service_id: service?.id ?? null, title, name, phone, start_at: start, end_at: end, reminder_consent: Number(consent), status: 'confirmed', revision: 1, created_at: at, updated_at: at };
    db.prepare('INSERT INTO appointments(id,reference,service_id,title,name,phone,start_at,end_at,reminder_consent,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
    db.prepare('UPDATE appointments SET notes=?,buffer_after_minutes=?,phone_normalized=? WHERE id=?').run(notes, buffer, phone, row.id);
    Object.assign(row, { notes, buffer_after_minutes: buffer, outcome: 'scheduled', phone_normalized: phone });
    planReminder(row, at);
    audit(publicBooking ? 'public_booking_created' : 'appointment_created', row.id, at);
    return row;
  }
  function createPublicBooking(input, at = clock()) {
    return transaction(() => {
      let clientRequestId;
      let payloadHash;
      if (input.clientRequestId !== undefined) {
        if (typeof input.clientRequestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientRequestId)) fail('invalid_request_id', 'Riprova dal calendario.');
        clientRequestId = input.clientRequestId.toLowerCase();
        payloadHash = createHash('sha256').update(JSON.stringify({ serviceId: input.serviceId, date: input.date, time: input.time, name: cleanText(input.name, 'Nome', { min: 2, max: 100 }), phone: normalizePhone(input.phone), reminderConsent: boolean(input.reminderConsent, 'Promemoria WhatsApp'), notes: noteText(input.notes) })).digest('hex');
        const prior = db.prepare('SELECT * FROM booking_idempotency WHERE client_request_id=?').get(clientRequestId);
        if (prior) {
          if (prior.payload_hash !== payloadHash) fail('request_id_reused', 'La prenotazione è stata modificata. Invia una nuova richiesta dal calendario.', 409);
          return publicBookingReceipt(db.prepare('SELECT * FROM appointments WHERE id=?').get(prior.appointment_id));
        }
      }
      const row = insertAppointment(input, at, true);
      if (clientRequestId) db.prepare('INSERT INTO booking_idempotency(client_request_id,payload_hash,appointment_id) VALUES(?,?,?)').run(clientRequestId, payloadHash, row.id);
      return publicBookingReceipt(row);
    });
  }
  function publicBookingReceipt(row) {
    const appointment = mapAppointment(row);
    return { id: row.id, reference: row.reference, status: row.status, serviceName: row.title, date: appointment.date, time: appointment.time, durationMinutes: appointment.durationMinutes, startsAt: row.start_at, endsAt: row.end_at };
  }
  function createAdminAppointment(input, at = clock()) { return transaction(() => mapAppointment(insertAppointment(input, at, false))); }
  function listCustomers({ query = '', limit = 100 } = {}, at = clock()) {
    query = cleanText(query, 'Ricerca clienti', { min: 0, max: 100 });
    integer(limit, 'Numero clienti', 1, 200);
    const customers = new Map();
    const rows = db.prepare(`
      SELECT name,phone,start_at,status,updated_at,created_at,'appointment' AS kind FROM appointments
      UNION ALL
      SELECT name,phone,requested_start_at AS start_at,status,updated_at,created_at,'request' AS kind FROM booking_requests
      ORDER BY updated_at,created_at,kind
    `).all();
    for (const row of rows) {
      let phone;
      try { phone = normalizePhone(row.phone); }
      // Invalid legacy contacts cannot be turned into a guessed phone number.
      // They do not prevent valid contacts from being shown in the directory.
      catch (error) { if (error instanceof DomainError && error.code === 'invalid_phone') continue; throw error; }
      let customer = customers.get(phone);
      if (!customer) {
        customer = { phone, name: row.name, appointmentCount: 0, requestCount: 0, lastAt: null, nextAt: null, updatedAt: row.updated_at };
        customers.set(phone, customer);
      }
      if (row.updated_at >= customer.updatedAt) {
        customer.name = row.name;
        customer.updatedAt = row.updated_at;
      }
      if (row.kind === 'request') customer.requestCount++;
      else {
        customer.appointmentCount++;
        if (row.status === 'confirmed') {
          if (row.start_at <= at && (customer.lastAt === null || row.start_at > customer.lastAt)) customer.lastAt = row.start_at;
          if (row.start_at > at && (customer.nextAt === null || row.start_at < customer.nextAt)) customer.nextAt = row.start_at;
        }
      }
    }
    const searchText = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it-IT');
    const needle = searchText(query);
    const phoneNeedle = query.replace(/[ ()\-.]/g, '').replace(/^00/, '+');
    return [...customers.values()]
      .filter((customer) => !query || searchText(customer.name).includes(needle) || (phoneNeedle && customer.phone.includes(phoneNeedle)))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'it-IT') || a.phone.localeCompare(b.phone))
      .slice(0, limit)
      .map(({ phone, name, appointmentCount, requestCount, lastAt, nextAt }) => ({
        phone, name, appointmentCount, requestCount,
        lastDate: lastAt === null ? null : toLocalParts(lastAt).date,
        nextDate: nextAt === null ? null : toLocalParts(nextAt).date,
      }));
  }
  function getCustomerHistory(inputPhone, { limit = 30 } = {}) {
    const phone = normalizePhone(inputPhone);
    integer(limit, 'Numero elementi nello storico', 1, 100);
    const appointments = db.prepare('SELECT * FROM appointments WHERE phone_normalized=? ORDER BY start_at DESC,created_at DESC,id LIMIT ?').all(phone, limit).map((row) => ({ ...mapAppointment(row), phone }));
    const requests = db.prepare('SELECT * FROM booking_requests WHERE phone_normalized=? ORDER BY requested_start_at DESC,created_at DESC,id LIMIT ?').all(phone, limit).map((row) => ({ ...mapRequest(row), phone }));
    return { appointments, requests };
  }
  function getCustomerProfile(inputPhone) {
    const phone = normalizePhone(inputPhone);
    if (!db.prepare('SELECT id FROM appointments WHERE phone_normalized=? UNION ALL SELECT id FROM booking_requests WHERE phone_normalized=? LIMIT 1').get(phone, phone)) fail('customer_not_found', 'Cliente non presente nella rubrica.', 404);
    const profile = db.prepare('SELECT * FROM customer_profiles WHERE phone=?').get(phone);
    return { phone, notes: profile?.notes || '', updatedAt: profile?.updated_at ?? null, version: profile?.version ?? 0 };
  }
  function updateCustomerProfile(input, at = clock()) {
    requireObject(input);
    const notes = noteText(input.notes, 2000);
    integer(input.version, 'Versione della scheda', 0, Number.MAX_SAFE_INTEGER - 1);
    return transaction(() => {
      const current = getCustomerProfile(input.phone);
      if (current.version !== input.version) fail('profile_changed', 'Le note sono state modificate. Ricarica la scheda senza perdere la tua bozza.', 409);
      db.prepare('INSERT INTO customer_profiles(phone,notes,updated_at,version) VALUES(?,?,?,?) ON CONFLICT(phone) DO UPDATE SET notes=excluded.notes,updated_at=excluded.updated_at,version=excluded.version').run(current.phone, notes, at, current.version + 1);
      audit('customer_profile_updated', null, at);
      return getCustomerProfile(current.phone);
    });
  }
  function listAppointments({ from, to } = {}, at = clock()) {
    const today = toLocalParts(at).date;
    from ??= addDays(today, -7);
    to ??= addDays(today, 7);
    parseDate(from); parseDate(to);
    if (from > to || parseDate(to).utc - parseDate(from).utc > 366 * 86_400_000) fail('invalid_range', 'Scegli un intervallo di date valido, fino a un anno.');
    return db.prepare('SELECT * FROM appointments WHERE end_at+buffer_after_minutes*60000 > ? AND start_at < ? ORDER BY start_at,id').all(localDateTimeToEpoch(from, '00:00'), localDateTimeToEpoch(addDays(to, 1), '00:00')).map(mapAppointment);
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
      const outcome = patch.outcome ?? row.outcome;
      if (!['scheduled', 'completed', 'no_show'].includes(outcome) || (outcome !== 'scheduled' && (status !== 'confirmed' || start > at))) fail('invalid_outcome', 'Puoi registrare l’esito soltanto per un appuntamento iniziato e non annullato.');
      const buffer = Object.hasOwn(patch, 'serviceId') && service?.id !== row.service_id ? (service?.buffer_after_minutes ?? 0) : row.buffer_after_minutes;
      const changed = {
        ...row, service_id: service?.id ?? null, title: Object.hasOwn(patch, 'title') ? cleanText(patch.title, 'Servizio', { max: 160 }) : (Object.hasOwn(patch, 'serviceId') && service ? service.name : row.title),
        name: Object.hasOwn(patch, 'name') ? cleanText(patch.name, 'Nome', { min: 2, max: 100 }) : row.name,
        phone: Object.hasOwn(patch, 'phone') ? normalizePhone(patch.phone) : row.phone,
        reminder_consent: Object.hasOwn(patch, 'reminderConsent') ? Number(boolean(patch.reminderConsent, 'Promemoria WhatsApp')) : row.reminder_consent,
        start_at: start, end_at: end, status, outcome, notes: Object.hasOwn(patch, 'notes') ? noteText(patch.notes) : row.notes, buffer_after_minutes: buffer, updated_at: at,
      };
      if (status === 'confirmed' && conflicts(start, end + buffer * 60_000, id)) fail('slot_conflict', 'Questo orario è già occupato. Scegli un altro orario.', 409);
      const relevant = ['start_at', 'end_at', 'phone', 'reminder_consent', 'status'].some((key) => changed[key] !== row[key]);
      if (relevant) changed.revision++;
      db.prepare('UPDATE appointments SET service_id=?,title=?,name=?,phone=?,start_at=?,end_at=?,reminder_consent=?,status=?,revision=?,updated_at=? WHERE id=?').run(changed.service_id, changed.title, changed.name, changed.phone, start, end, changed.reminder_consent, status, changed.revision, at, id);
      db.prepare('UPDATE appointments SET notes=?,outcome=?,buffer_after_minutes=?,phone_normalized=? WHERE id=?').run(changed.notes, outcome, buffer, normalizePhone(changed.phone), id);
      if (relevant) {
        invalidateUnsent(id, at, status === 'cancelled' ? 'appointment_cancelled' : 'appointment_changed');
        planReminder(changed, at);
      }
      if (outcome !== 'scheduled') invalidateUnsent(id, at, 'appointment_completed');
      audit(status === 'cancelled' ? 'appointment_cancelled' : 'appointment_updated', id, at);
      customerAccessSync?.(id, { ownershipChanged: normalizePhone(changed.phone) !== normalizePhone(row.phone) });
      return mapAppointment(changed);
    });
  }
  function uniqueServiceName(name, exceptId = '') {
    const normalized = name.toLocaleLowerCase('it-IT');
    if (listServices().some((service) => service.id !== exceptId && service.name.toLocaleLowerCase('it-IT') === normalized)) {
      fail('duplicate_service', 'Esiste già un servizio con questo nome. Modifica o ripristina quello esistente.', 409);
    }
  }
  function createService(input, at = clock()) {
    requireObject(input);
    return transaction(() => {
      if (db.prepare('SELECT COUNT(*) AS total FROM services').get().total >= 200) fail('service_limit', 'Puoi gestire fino a 200 servizi.', 409);
      const name = cleanText(input.name, 'Servizio', { max: 100 });
      uniqueServiceName(name);
      const length = input.durationMinutes === undefined || input.durationMinutes === null ? null : duration(input.durationMinutes);
      const listed = Object.hasOwn(input, 'listed') ? boolean(input.listed, 'Visibile nel calendario') : true;
      const description = noteText(input.description, 1000);
      const priceCents = input.priceCents === undefined || input.priceCents === null ? null : integer(input.priceCents, 'Prezzo in centesimi', 0, 1000000);
      const priceFrom = input.priceFrom === undefined ? false : boolean(input.priceFrom, 'Prezzo a partire da');
      const buffer = input.bufferAfterMinutes === undefined ? 0 : integer(input.bufferAfterMinutes, 'Tempo dopo il servizio', 0, 120);
      const enabled = Object.hasOwn(input, 'enabled') ? boolean(input.enabled, 'Conferma immediata') : false;
      if (listed && enabled && length === null) fail('duration_required', 'Imposta una durata prima di attivare il servizio.');
      const id = randomUUID();
      const sortOrder = (db.prepare('SELECT MAX(sort_order) AS last FROM services').get().last ?? -1) + 1;
      db.prepare('INSERT INTO services(id,name,duration_minutes,enabled,sort_order,listed) VALUES(?,?,?,?,?,?)').run(id, name, length, Number(listed && enabled), sortOrder, Number(listed));
      db.prepare('UPDATE services SET description=?,price_cents=?,price_from=?,buffer_after_minutes=? WHERE id=?').run(description, priceCents, Number(priceFrom), buffer, id);
      audit('service_created', id, at);
      return mapService(getService(id));
    });
  }
  function updateService(id, patch, at = clock()) {
    requireObject(patch);
    return transaction(() => {
      const service = getService(id);
      const name = Object.hasOwn(patch, 'name') ? cleanText(patch.name, 'Servizio', { max: 100 }) : service.name;
      uniqueServiceName(name, id);
      const length = Object.hasOwn(patch, 'durationMinutes') ? (patch.durationMinutes === null ? null : duration(patch.durationMinutes)) : service.duration_minutes;
      const enabled = Object.hasOwn(patch, 'enabled') ? boolean(patch.enabled, 'Servizio attivo') : Boolean(service.enabled);
      const listed = Object.hasOwn(patch, 'listed') ? boolean(patch.listed, 'Visibile nel calendario') : Boolean(service.listed);
      const description = Object.hasOwn(patch, 'description') ? noteText(patch.description, 1000) : service.description;
      const priceCents = Object.hasOwn(patch, 'priceCents') ? (patch.priceCents === null ? null : integer(patch.priceCents, 'Prezzo in centesimi', 0, 1000000)) : service.price_cents;
      const priceFrom = Object.hasOwn(patch, 'priceFrom') ? boolean(patch.priceFrom, 'Prezzo a partire da') : Boolean(service.price_from);
      const buffer = Object.hasOwn(patch, 'bufferAfterMinutes') ? integer(patch.bufferAfterMinutes, 'Tempo dopo il servizio', 0, 120) : service.buffer_after_minutes;
      if (listed && patch.enabled === true && length === null) fail('duration_required', 'Imposta una durata prima di attivare il servizio.');
      db.prepare('UPDATE services SET name=?,duration_minutes=?,enabled=?,listed=? WHERE id=?').run(name, length, Number(listed && enabled && length !== null), Number(listed), id);
      db.prepare('UPDATE services SET description=?,price_cents=?,price_from=?,buffer_after_minutes=? WHERE id=?').run(description, priceCents, Number(priceFrom), buffer, id);
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
      boolean(next.requestEnabled, 'Richieste dal calendario');
      boolean(next.economyMode, 'Modalità risparmio');
      boolean(next.customerChangesEnabled, 'Modifiche da parte della cliente');
      integer(next.bookingLeadMinutes, 'Preavviso di prenotazione', 0, 10080);
      integer(next.customerChangeNoticeHours, 'Preavviso per modifiche', 0, 168);
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
  const manualAudit = db.prepare("SELECT created_at FROM audit_log WHERE event='reminder_marked_manual' AND resource_id=? ORDER BY created_at DESC,id DESC LIMIT 1");
  function mapReminder(row) {
    const local = toLocalParts(row.start_at);
    return { id: row.id, appointmentId: row.appointment_id, name: row.name, phone: row.phone, date: local.date, time: local.time, status: row.status, dueAt: row.due_at, attemptCount: row.attempt_count, errorCode: row.error_code, errorText: row.error_text, providerMessageId: row.provider_message_id, staleRevision: row.appointment_revision !== row.current_revision, manualSentAt: manualAudit.get(row.appointment_id)?.created_at ?? null };
  }
  function listReminders({ limit = 100, date } = {}) {
    integer(limit, 'Numero promemoria', 1, 500);
    if (date !== undefined) {
      parseDate(date);
      return db.prepare('SELECT r.*,a.name,a.phone,a.start_at,a.revision AS current_revision FROM reminders r JOIN appointments a ON a.id=r.appointment_id WHERE r.due_at>=? AND r.due_at<? ORDER BY r.due_at,r.id LIMIT ?')
        .all(localDateTimeToEpoch(date, '00:00'), localDateTimeToEpoch(addDays(date, 1), '00:00'), limit).map(mapReminder);
    }
    return db.prepare('SELECT r.*,a.name,a.phone,a.start_at,a.revision AS current_revision FROM reminders r JOIN appointments a ON a.id=r.appointment_id ORDER BY r.due_at DESC,r.id LIMIT ?').all(limit).map(mapReminder);
  }
  function markReminderManual(id, at = clock()) {
    return transaction(() => {
      const query = db.prepare('SELECT r.*,a.name,a.phone,a.start_at,a.revision AS current_revision,a.status AS appointment_status FROM reminders r JOIN appointments a ON a.id=r.appointment_id WHERE r.id=?');
      const row = query.get(id);
      if (!row) fail('reminder_not_found', 'Promemoria non trovato.', 404);
      if (manualAudit.get(row.appointment_id)) return mapReminder(row);
      if (row.status === 'sending' || db.prepare("SELECT id FROM reminders WHERE appointment_id=? AND status='sending' LIMIT 1").get(row.appointment_id)) fail('reminder_sending', 'Un invio automatico è in corso. Attendi il suo esito.', 409);
      if (row.provider_message_id || ['accepted', 'delivered', 'read'].includes(row.status)) fail('reminder_already_sent', 'Il promemoria ha già un invio registrato. Controlla il suo esito.', 409);
      if (row.appointment_status !== 'confirmed' || row.start_at <= at) fail('appointment_not_active', 'L’appuntamento è annullato o già trascorso.', 409);
      audit('reminder_marked_manual', row.appointment_id, at, JSON.stringify({ reminderId: row.id }));
      // An uncertain paid attempt remains counted and visible for review.
      db.prepare("UPDATE reminders SET status='skipped',error_code='manual_sent',error_text=NULL,lease_until=NULL,updated_at=? WHERE appointment_id=? AND provider_message_id IS NULL AND status IN ('pending','failed')")
        .run(at, row.appointment_id);
      return mapReminder(query.get(id));
    });
  }
  function getStats(at = clock()) {
    const today = toLocalParts(at).date;
    const start = localDateTimeToEpoch(today, '00:00');
    const end = localDateTimeToEpoch(addDays(today, 1), '00:00');
    const period = reminderQuotaPeriod(at);
    return {
      todayAppointments: db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE status='confirmed' AND start_at>=? AND start_at<?").get(start, end).count,
      upcomingAppointments: db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE status='confirmed' AND start_at>? ").get(at).count,
      pendingReminders: db.prepare("SELECT COUNT(*) AS count FROM reminders WHERE status='pending'").get().count,
      pendingRequests: db.prepare("SELECT COUNT(*) AS count FROM booking_requests WHERE status='pending'").get().count,
      sentThisMonth: conservativeReminderCount(db, period.monthStart, period.monthEnd),
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
  return { db, transaction, setCustomerAccessSync: (callback) => { customerAccessSync = callback; }, close: () => db.close(), getPublicConfig, getAvailability, getRequestAvailability, getAvailabilityRange, getAppointmentAvailability, createPublicBooking, createPublicRequest, listRequests, confirmRequest, declineRequest, listAppointments, createAdminAppointment, updateAppointment, listBlocks, createBlock, deleteBlock, listCustomers, getCustomerHistory, getCustomerProfile, updateCustomerProfile, listServices, createService, updateService, getSettings, updateSettings, listReminders, markReminderManual, getStats, backup };
}
