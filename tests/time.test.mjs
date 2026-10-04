import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeToEpoch, toLocalParts, addDays, reminderDueAt } from '../server/time.mjs';

test('Europe/Rome follows winter and summer offsets independent of process timezone', () => {
  assert.equal(localDateTimeToEpoch('2026-01-13', '09:00'), Date.parse('2026-01-13T08:00:00Z'));
  assert.equal(localDateTimeToEpoch('2026-07-14', '09:00'), Date.parse('2026-07-14T07:00:00Z'));
  assert.deepEqual(toLocalParts(Date.parse('2026-07-13T22:30:00Z')), { date: '2026-07-14', time: '00:30', weekday: 'Tuesday' });
});

test('DST missing and repeated local times are rejected instead of guessed', () => {
  assert.throws(() => localDateTimeToEpoch('2026-03-29', '02:30'), { code: 'invalid_local_time' });
  assert.throws(() => localDateTimeToEpoch('2026-10-25', '02:30'), { code: 'ambiguous_local_time' });
  assert.equal(localDateTimeToEpoch('2026-03-29', '03:30'), Date.parse('2026-03-29T01:30:00Z'));
  assert.equal(localDateTimeToEpoch('2026-10-25', '03:30'), Date.parse('2026-10-25T02:30:00Z'));
});

test('previous-day reminders preserve wall clock across both DST transitions', () => {
  assert.equal(reminderDueAt('2026-03-29', '18:00'), Date.parse('2026-03-28T17:00:00Z'));
  assert.equal(reminderDueAt('2026-03-30', '18:00'), Date.parse('2026-03-29T16:00:00Z'));
  assert.equal(reminderDueAt('2026-10-25', '18:00'), Date.parse('2026-10-24T16:00:00Z'));
  assert.equal(reminderDueAt('2026-10-26', '18:00'), Date.parse('2026-10-25T17:00:00Z'));
  assert.equal(addDays('2026-03-29', -1), '2026-03-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('invalid calendar dates and clocks never normalize into other days', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '26-01-01', '2026-1-01']) {
    assert.throws(() => localDateTimeToEpoch(date, '09:00'), { code: 'invalid_date' });
  }
  for (const time of ['24:00', '12:60', '9:00', '09:00:00']) {
    assert.throws(() => localDateTimeToEpoch('2026-01-01', time), { code: 'invalid_time' });
  }
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});
