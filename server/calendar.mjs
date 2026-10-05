import { DomainError } from './domain.mjs';

// A reserved domain keeps the UID stable without depending on the hosting URL.
const UID_DOMAIN = 'desideri-di-felicita.invalid';

function unavailable() {
  throw new DomainError(409, 'calendar_unavailable', 'Il calendario è disponibile solo per un appuntamento confermato.');
}

function utcDateTime(epoch) {
  if (!Number.isSafeInteger(epoch)) unavailable();
  const date = new Date(epoch);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) unavailable();
  return date.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function calendarText(value) {
  return String(value ?? '').toWellFormed().normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  const folded = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const length = Buffer.byteLength(character, 'utf8');
    if (octets + length > 75) {
      folded.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += length;
  }
  folded.push(current);
  return folded.join('\r\n');
}

function businessLocation(address = {}) {
  const locality = [address.postalCode, address.addressLocality ?? address.city].filter(Boolean).join(' ');
  const city = locality + (address.province ? ` (${address.province})` : '');
  return [address.streetAddress ?? address.street, city, address.addressRegion ?? address.region,
    address.addressCountry ?? address.country].filter(Boolean).join(', ');
}

/** Serialize only an appointment's public calendar fields, never its customer data. */
export function appointmentCalendar({ appointment, business, now = Date.now() }) {
  if (!appointment || appointment.status !== 'confirmed' ||
      ![undefined, null, 'scheduled'].includes(appointment.outcome)) unavailable();
  const start = appointment.start_at ?? appointment.startsAt;
  const end = appointment.end_at ?? appointment.endsAt;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) unavailable();
  const id = appointment.id;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,128}$/iu.test(id)) unavailable();
  const revision = appointment.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0 || revision > 2_147_483_647) unavailable();
  const salon = business?.businessName ?? '';
  const service = appointment.title ?? appointment.serviceName ?? '';
  const summary = [salon, service].filter(Boolean).join(' — ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Desideri di Felicita//Agenda//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}@${UID_DOMAIN}`,
    `DTSTAMP:${utcDateTime(now)}`,
    `DTSTART:${utcDateTime(start)}`,
    `DTEND:${utcDateTime(end)}`,
    `SEQUENCE:${revision}`,
    `SUMMARY:${calendarText(summary)}`,
    `LOCATION:${calendarText(businessLocation(business?.address))}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
