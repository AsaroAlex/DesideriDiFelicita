import { randomBytes, randomUUID, createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { DomainError, fail, integer, requireObject, normalizePhone } from './domain.mjs';
import { toLocalParts, parseDate, parseTime } from './time.mjs';

const SEVEN_DAYS = 7 * 86_400_000;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const unavailable = () => new DomainError(404, 'customer_link_unavailable', 'Il collegamento non è valido o è scaduto. Contatta il salone.');

function accessKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const master = Buffer.from(value, 'base64');
  if (master.length !== 32 || master.toString('base64') !== value) return null;
  return Buffer.from(hkdfSync('sha256', master, Buffer.from('desideri-di-felicita'), Buffer.from('customer-access:v1'), 32));
}

export function createCustomerAccess({ store, config, now = Date.now }) {
  const db = store.db;
  const key = accessKey(config.whatsappConfigKey);
  db.exec(`CREATE TABLE IF NOT EXISTS customer_access (
    id TEXT PRIMARY KEY,request_id TEXT UNIQUE REFERENCES booking_requests(id),appointment_id TEXT UNIQUE REFERENCES appointments(id),
    token_hash TEXT NOT NULL UNIQUE,nonce BLOB NOT NULL CHECK(length(nonce)=32),version INTEGER NOT NULL CHECK(version>0),
    expires_at INTEGER NOT NULL,revoked_at INTEGER,created_at INTEGER NOT NULL,
    CHECK((request_id IS NOT NULL AND appointment_id IS NULL) OR (request_id IS NULL AND appointment_id IS NOT NULL))
  )`);
  const readHash = db.prepare('SELECT * FROM customer_access WHERE token_hash=?');
  const requestQuery = db.prepare('SELECT * FROM booking_requests WHERE id=?');
  const appointmentQuery = db.prepare('SELECT * FROM appointments WHERE id=?');

  function tokenFor(grant) {
    if (!key) return null;
    const kind = grant.request_id ? 'request' : 'appointment';
    return createHmac('sha256', key).update(JSON.stringify(['v1', grant.id, kind, grant.request_id || grant.appointment_id, Buffer.from(grant.nonce).toString('base64url'), grant.version])).digest('base64url');
  }
  function resource(grant) {
    if (grant.appointment_id) {
      const appointment = appointmentQuery.get(grant.appointment_id);
      if (!appointment) throw unavailable();
      return { appointment };
    }
    const request = requestQuery.get(grant.request_id);
    if (!request) throw unavailable();
    if (request.status === 'confirmed') {
      const appointment = appointmentQuery.get(request.appointment_id);
      if (!appointment) throw unavailable();
      return { request, appointment };
    }
    return { request };
  }
  const expiration = ({ appointment, request }) => (appointment ? appointment.end_at : request.requested_start_at) + SEVEN_DAYS;
  function syncAppointment(id, { ownershipChanged = false } = {}) {
    const appointment = appointmentQuery.get(id);
    if (!appointment) return;
    db.prepare(`UPDATE customer_access SET expires_at=?,revoked_at=CASE WHEN ? THEN ? ELSE revoked_at END
      WHERE appointment_id=? OR request_id IN (SELECT id FROM booking_requests WHERE appointment_id=?)`)
      .run(appointment.end_at + SEVEN_DAYS, Number(ownershipChanged), now(), id, id);
  }
  store.setCustomerAccessSync(syncAppointment);

  function issue(kind, id, { rotate = false, optional = false, recipientPhone } = {}) {
    if (!key) {
      if (optional) return { managementPath: null, expiresAt: null };
      fail('customer_access_unavailable', 'Il collegamento cliente non è disponibile. Contatta chi gestisce il sito.', 503);
    }
    if (typeof rotate !== 'boolean') fail('invalid_input', 'Indica se rigenerare il collegamento.');
    return store.transaction(() => {
      let grant;
      let target;
      if (kind === 'request') {
        const request = requestQuery.get(id);
        if (!request) fail('request_not_found', 'Richiesta non trovata.', 404);
        grant = db.prepare('SELECT * FROM customer_access WHERE request_id=? OR appointment_id=? ORDER BY created_at,id LIMIT 1').get(id, request.appointment_id || '');
        target = request.status === 'confirmed' ? { request, appointment: appointmentQuery.get(request.appointment_id) } : { request };
      } else if (kind === 'appointment') {
        const appointment = appointmentQuery.get(id);
        if (!appointment) fail('appointment_not_found', 'Appuntamento non trovato.', 404);
        grant = db.prepare(`SELECT * FROM customer_access WHERE appointment_id=? OR request_id IN
          (SELECT id FROM booking_requests WHERE appointment_id=?) ORDER BY created_at,id LIMIT 1`).get(id, id);
        target = { appointment };
      } else throw new Error('Invalid customer resource kind');
      // A previous contact's original booking UUID must not retrieve a new
      // contact's rotated grant after the owner reassigns the appointment.
      if (optional && recipientPhone !== undefined && normalizePhone(recipientPhone) !== normalizePhone(target.appointment?.phone ?? target.request.phone)) {
        return { managementPath: null, expiresAt: expiration(target) };
      }
      if (!grant) {
        grant = { id: randomUUID(), request_id: kind === 'request' ? id : null, appointment_id: kind === 'appointment' ? id : null, nonce: randomBytes(32), version: 1, expires_at: expiration(target), revoked_at: null, created_at: now() };
        grant.token_hash = tokenHash(tokenFor(grant));
        db.prepare('INSERT INTO customer_access(id,request_id,appointment_id,token_hash,nonce,version,expires_at,revoked_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(grant.id, grant.request_id, grant.appointment_id, grant.token_hash, grant.nonce, grant.version, grant.expires_at, null, grant.created_at);
      } else {
        const derivedHash = tokenHash(tokenFor(grant));
        if ((derivedHash !== grant.token_hash || grant.revoked_at !== null) && !rotate) {
          if (optional) return { managementPath: null, expiresAt: grant.expires_at };
          fail('customer_link_rotation_required', 'Rigenera esplicitamente il collegamento per renderlo nuovamente disponibile.', 409);
        }
        if (rotate) {
          grant.nonce = randomBytes(32); grant.version++; grant.revoked_at = null;
          grant.token_hash = tokenHash(tokenFor(grant));
          db.prepare('UPDATE customer_access SET nonce=?,version=?,token_hash=?,revoked_at=NULL WHERE id=?').run(grant.nonce, grant.version, grant.token_hash, grant.id);
          db.prepare("INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES('customer_link_rotated',?,?,NULL)").run(grant.id, now());
        }
        const expiry = expiration(target);
        if (expiry !== grant.expires_at) { grant.expires_at = expiry; db.prepare('UPDATE customer_access SET expires_at=? WHERE id=?').run(expiry, grant.id); }
      }
      return { managementPath: `/appuntamento/#chiave=${tokenFor(grant)}`, expiresAt: grant.expires_at };
    });
  }

  function resolve(token) {
    if (!key || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const grant = readHash.get(tokenHash(token));
    if (!grant || grant.revoked_at !== null || grant.expires_at <= now()) throw unavailable();
    const expected = tokenFor(grant);
    // Hash lookup alone would leave previous-key links valid after key rotation.
    if (!expected || !timingSafeEqual(Buffer.from(expected), Buffer.from(token)) || tokenHash(expected) !== grant.token_hash) throw unavailable();
    return { grant, ...resource(grant) };
  }
  function changeAllowed(target) {
    const settings = store.getSettings();
    const start = target.appointment?.start_at ?? target.request?.requested_start_at;
    return Boolean(settings.customerChangesEnabled && start > now() && start - now() >= settings.customerChangeNoticeHours * 3_600_000);
  }
  function view(target) {
    const { grant, appointment, request } = target;
    const settings = store.getSettings();
    const item = appointment || request;
    const local = toLocalParts(appointment ? appointment.start_at : request.requested_start_at);
    const allowed = changeAllowed(target);
    const active = Boolean(appointment && appointment.status === 'confirmed' && appointment.outcome === 'scheduled');
    const status = appointment ? appointment.status : request.withdrawn_at !== null ? 'withdrawn' : request.status;
    const serviceName = appointment ? appointment.title : db.prepare('SELECT name FROM services WHERE id=?').get(request.service_id)?.name || 'Servizio';
    return {
      kind: appointment ? 'appointment' : 'request', reference: request?.reference ?? item.reference, status, serviceName,
      date: local.date, time: local.time, durationMinutes: appointment ? (appointment.end_at - appointment.start_at) / 60_000 : null,
      revision: appointment?.revision ?? null,
      canCancel: Boolean(active && allowed), canReschedule: Boolean(active && allowed),
      canDownloadCalendar: active,
      canWithdraw: Boolean(!appointment && request.status === 'pending' && allowed),
      changeNoticeHours: settings.customerChangeNoticeHours, changesEnabled: settings.customerChangesEnabled,
      managementExpiresAt: grant.expires_at,
      ...(appointment ? { startsAt: appointment.start_at, endsAt: appointment.end_at } : {}),
    };
  }
  function requireChange(target) {
    if (!target.appointment || target.appointment.status !== 'confirmed' || target.appointment.outcome !== 'scheduled' || !changeAllowed(target)) {
      fail('customer_changes_unavailable', 'Per modificare questo appuntamento contatta il salone.', 409);
    }
  }
  function cancel(token, input) {
    requireObject(input); integer(input.revision, 'Versione appuntamento', 1, Number.MAX_SAFE_INTEGER);
    return store.transaction(() => {
      const target = resolve(token);
      if (target.appointment?.status === 'cancelled') return view(target);
      requireChange(target);
      if (target.appointment.revision !== input.revision) fail('appointment_changed', 'L’appuntamento è cambiato. Ricarica i dettagli prima di continuare.', 409);
      store.updateAppointment(target.appointment.id, { status: 'cancelled' }, now());
      db.prepare("INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES('customer_appointment_cancelled',?,?,NULL)").run(target.appointment.id, now());
      return view(resolve(token));
    });
  }
  function reschedule(token, input) {
    requireObject(input); integer(input.revision, 'Versione appuntamento', 1, Number.MAX_SAFE_INTEGER);
    parseDate(input.date); parseTime(input.time);
    return store.transaction(() => {
      const target = resolve(token);
      const current = target.appointment && toLocalParts(target.appointment.start_at);
      if (target.appointment?.status === 'confirmed' && current.date === input.date && current.time === input.time) return view(target);
      requireChange(target);
      if (target.appointment.revision !== input.revision) fail('appointment_changed', 'L’appuntamento è cambiato. Ricarica i dettagli prima di continuare.', 409);
      const slots = store.getAppointmentAvailability({ id: target.appointment.id, from: input.date, days: 1 }, now()).days[0]?.slots || [];
      if (!slots.some((slot) => slot.time === input.time)) fail('slot_unavailable', 'Questo orario non è più disponibile. Scegli un altro orario.', 409);
      store.updateAppointment(target.appointment.id, { date: input.date, time: input.time }, now());
      db.prepare("INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES('customer_appointment_rescheduled',?,?,NULL)").run(target.appointment.id, now());
      return view(resolve(token));
    });
  }
  function withdraw(token) {
    return store.transaction(() => {
      const target = resolve(token);
      if (target.request?.withdrawn_at !== null && target.request?.withdrawn_at !== undefined) return view(target);
      if (target.appointment || target.request?.status !== 'pending' || !changeAllowed(target)) fail('request_not_pending', 'Questa richiesta non è più ritirabile. Contatta il salone.', 409);
      db.prepare("UPDATE booking_requests SET status='declined',withdrawn_at=?,updated_at=? WHERE id=? AND status='pending'").run(now(), now(), target.request.id);
      db.prepare("INSERT INTO audit_log(event,resource_id,created_at,detail) VALUES('customer_request_withdrawn',?,?,NULL)").run(target.request.id, now());
      return view(resolve(token));
    });
  }
  function availability(token, range) {
    const target = resolve(token);
    requireChange(target);
    return store.getAppointmentAvailability({ id: target.appointment.id, ...range }, now());
  }
  return { issue, resolve, getView: (token) => view(resolve(token)), cancel, reschedule, withdraw, availability, syncAppointment };
}
