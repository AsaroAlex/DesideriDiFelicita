import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCalendar } from '../server/calendar.mjs';
import { DomainError } from '../server/domain.mjs';

const business = {
  businessName: 'Desideri di Felicità',
  address: { streetAddress: 'Piazza Torino Bosi 6', addressLocality: 'Galliera',
    addressRegion: 'Emilia-Romagna', postalCode: '40015', addressCountry: 'IT' },
};
const appointment = {
  id: '10ecc9fc-7011-4f20-8066-512c8b260b87', reference: 'DF-123456',
  title: 'Cura del riccio', start_at: Date.parse('2026-10-06T07:00:00Z'),
  end_at: Date.parse('2026-10-06T08:30:00Z'), status: 'confirmed',
  outcome: 'scheduled', revision: 1,
};
const now = Date.parse('2026-10-05T10:00:00Z');
const serialize = (changes = {}, salon = business) => appointmentCalendar({
  appointment: { ...appointment, ...changes }, business: salon, now,
});
const unfold = (calendar) => calendar.replace(/\r\n[ \t]/g, '');

test('ICS contains a confirmed event with the actual duration, UTC epochs and CRLF endings', () => {
  const calendar = serialize();
  const unfolded = unfold(calendar);
  assert.ok(calendar.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(calendar.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
  assert.ok(!/(?<!\r)\n|\r(?!\n)/u.test(calendar));
  assert.match(unfolded, /\r\nDTSTAMP:20261005T100000Z\r\n/);
  assert.match(unfolded, /\r\nDTSTART:20261006T070000Z\r\nDTEND:20261006T083000Z\r\n/);
  assert.match(unfolded, /\r\nSUMMARY:Desideri di Felicità — Cura del riccio\r\n/);
  assert.match(unfolded, /\r\nLOCATION:Piazza Torino Bosi 6\\, 40015 Galliera\\, Emilia-Romagna\\, IT\r\n/);
  assert.match(unfolded, /\r\nSTATUS:CONFIRMED\r\n/);
});

test('UID remains stable after a reschedule while SEQUENCE follows the saved revision', () => {
  const previous = unfold(serialize());
  const moved = unfold(serialize({ start_at: appointment.start_at + 86_400_000,
    end_at: appointment.end_at + 86_400_000, revision: 4 }));
  assert.equal(previous.match(/^UID:(.+)$/m)[1], moved.match(/^UID:(.+)$/m)[1]);
  assert.match(previous, /\r\nSEQUENCE:1\r\n/);
  assert.match(moved, /\r\nSEQUENCE:4\r\n/);
  assert.match(moved, /\r\nDTSTART:20261007T070000Z\r\n/);
});

test('UTF-8 folding never exceeds 75 octets or splits multi-byte code points', () => {
  const title = 'é✨ capelli 🧑🏽‍🦱 '.repeat(30).trim();
  const calendar = serialize({ title });
  const lines = calendar.split('\r\n');
  assert.ok(lines.some((line) => line.startsWith(' ')), 'the long summary must be folded');
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `oversize line: ${line}`);
    assert.equal(Buffer.from(line).toString('utf8'), line, 'a physical line must contain complete code points');
    assert.ok(!line.includes('\ufffd'));
  }
  assert.ok(unfold(calendar).includes(`SUMMARY:Desideri di Felicità — ${title}\r\n`));
});

test('text escaping prevents properties from being injected through salon, service or location', () => {
  const calendar = serialize({ title: 'Colore; biondo, naturale\\soft\r\nATTENDEE:intruso@example.test' }, {
    businessName: 'Salone; felice, bello\\sì\nBEGIN:VALARM',
    address: { streetAddress: 'Via\\uno; 2, interno\rALTREP:evil\u0000',
      addressLocality: 'Città', addressCountry: 'IT' },
  });
  const logical = unfold(calendar);
  assert.ok(logical.includes('Salone\\; felice\\, bello\\\\sì\\nBEGIN:VALARM'));
  assert.ok(logical.includes('Colore\\; biondo\\, naturale\\\\soft\\nATTENDEE:intruso@example.test'));
  assert.ok(logical.includes('Via\\\\uno\\; 2\\, interno\\nALTREP:evil'));
  assert.ok(!logical.includes('\u0000'));
  assert.ok(!/^ATTENDEE:|^ALTREP:|^BEGIN:VALARM$/m.test(logical));
  assert.equal((logical.match(/^BEGIN:VEVENT$/gm) ?? []).length, 1);
});

test('calendar serializes no customer data, CRM notes, access tokens or automatic reminders', () => {
  const calendar = serialize({ name: 'cliente-privata-987', phone: '+393331112222',
    notes: 'richiesta-privata-654', customer_notes: 'nota-crm-321',
    managementPath: '/appuntamento/#chiave=token-segreto-123', reminder_consent: 1,
    accessToken: 'meta-segreto-456' }, { ...business, ownerName: 'proprietaria-privata-789',
    phone: '+393445556666', email: 'privata@example.test', notes: 'segreto-business-741' });
  for (const privateValue of ['cliente-privata-987', '+393331112222', 'richiesta-privata-654',
    'nota-crm-321', 'chiave=', 'token-segreto-123', 'meta-segreto-456',
    'proprietaria-privata-789', '+393445556666', 'privata@example.test', 'segreto-business-741']) {
    assert.ok(!calendar.includes(privateValue));
  }
  assert.ok(!/VALARM|ATTENDEE|ORGANIZER|DESCRIPTION|URL:/u.test(calendar));
});

test('requests, cancelled and concluded appointments cannot be exported as confirmed events', () => {
  for (const changes of [{ status: 'pending' }, { status: 'cancelled' }, { status: 'declined' },
    { outcome: 'completed' }, { outcome: 'no_show' }]) {
    assert.throws(() => serialize(changes), (error) => error instanceof DomainError &&
      error.status === 409 && error.code === 'calendar_unavailable');
  }
  for (const changes of [{ end_at: null }, { end_at: appointment.start_at },
    { start_at: NaN }, { revision: -1 }, { id: 'id\r\nBEGIN:VALARM' }]) {
    assert.throws(() => serialize(changes), { status: 409, code: 'calendar_unavailable' });
  }
});

test('events around both Rome DST transitions preserve saved UTC timestamps without wall-clock guesses', () => {
  const spring = unfold(serialize({ start_at: Date.parse('2026-03-29T00:30:00Z'),
    end_at: Date.parse('2026-03-29T02:00:00Z') }));
  assert.match(spring, /\r\nDTSTART:20260329T003000Z\r\nDTEND:20260329T020000Z\r\n/);
  const autumn = unfold(serialize({ start_at: Date.parse('2026-10-25T00:30:00Z'),
    end_at: Date.parse('2026-10-25T01:30:00Z') }));
  assert.match(autumn, /\r\nDTSTART:20261025T003000Z\r\nDTEND:20261025T013000Z\r\n/);
  assert.ok(!/TZID|VTIMEZONE|DURATION:/u.test(spring + autumn));
});

test('normalized appointment fields and the site address schema use the same saved event data', () => {
  const calendar = unfold(appointmentCalendar({ appointment: {
    id: appointment.id, serviceName: appointment.title, startsAt: appointment.start_at,
    endsAt: appointment.end_at, status: 'confirmed', revision: 2,
  }, business: { businessName: business.businessName, address: {
    street: 'Piazza Torino Bosi 6', city: 'Galliera', province: 'BO',
    postalCode: '40015', region: 'Emilia-Romagna', country: 'IT',
  } }, now }));
  assert.match(calendar, /\r\nDTSTART:20261006T070000Z\r\nDTEND:20261006T083000Z\r\n/);
  assert.match(calendar, /\r\nLOCATION:Piazza Torino Bosi 6\\, 40015 Galliera \(BO\)\\, Emilia-Romagna\\, IT\r\n/);
  assert.match(calendar, /\r\nSEQUENCE:2\r\n/);
});
