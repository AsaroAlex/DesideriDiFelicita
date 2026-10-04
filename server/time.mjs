import { fail } from './domain.mjs';

export const TIMEZONE = 'Europe/Rome';
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const localFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function parseDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail('invalid_date', 'Inserisci una data valida.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (year < 2000 || year > 2100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    fail('invalid_date', 'Inserisci una data valida.');
  }
  return { year, month, day, utc };
}

export function parseTime(time) {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) fail('invalid_time', 'Inserisci un orario valido.');
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) fail('invalid_time', 'Inserisci un orario valido.');
  return { hour, minute, minutes: hour * 60 + minute };
}

export function toLocalParts(epoch) {
  if (!Number.isFinite(epoch)) fail('invalid_date', 'Inserisci una data valida.');
  const parts = Object.fromEntries(localFormatter.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: DAY_NAMES[new Date(parseDate(date).utc).getUTCDay()] };
}

export function localDateTimeToEpoch(date, time) {
  const { year, month, day } = parseDate(date);
  const { hour, minute } = parseTime(time);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  // Collect both offsets around a transition, then round-trip each candidate.
  // An absent or ambiguous local time is rejected rather than guessed.
  const offsets = new Set();
  for (const delta of [-36, 0, 36]) {
    const probe = nominal + delta * 3_600_000;
    const local = toLocalParts(probe);
    const parsed = parseDate(local.date);
    const clock = parseTime(local.time);
    offsets.add(Date.UTC(parsed.year, parsed.month - 1, parsed.day, clock.hour, clock.minute) - probe);
  }
  const matches = [...offsets].map((offset) => nominal - offset).filter((candidate) => {
    const local = toLocalParts(candidate);
    return local.date === date && local.time === time;
  });
  if (!matches.length) fail('invalid_local_time', 'Questo orario non esiste nel cambio dell’ora. Scegli un altro orario.');
  if (matches.length > 1) fail('ambiguous_local_time', 'Questo orario è ripetuto nel cambio dell’ora. Scegli un altro orario.');
  return matches[0];
}

export function addDays(date, days) {
  if (!Number.isSafeInteger(days)) fail('invalid_date', 'Numero di giorni non valido.');
  const shifted = new Date(parseDate(date).utc + days * 86_400_000).toISOString().slice(0, 10);
  parseDate(shifted);
  return shifted;
}

export function weekday(date) {
  return DAY_NAMES[new Date(parseDate(date).utc).getUTCDay()];
}

export function minutesToTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) fail('invalid_time', 'Inserisci un orario valido.');
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function reminderDueAt(date, reminderTime = '18:00') {
  return localDateTimeToEpoch(addDays(date, -1), reminderTime);
}
