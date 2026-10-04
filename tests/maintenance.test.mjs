import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createMaintenance } from '../server/maintenance.mjs';

const HOUR = 60 * 60 * 1000;

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, expires_at INTEGER);');
  t.after(() => db.close());
  let instant = Date.parse('2026-10-04T08:00:00Z');
  let count = 0;
  const errors = [];
  const store = { db, backup: async () => { count += 1; } };
  const options = { store, now: () => instant, logError: () => errors.push('Daily maintenance failed.') };
  return { db, store, options, errors, calls: () => count, advance: (milliseconds) => { instant += milliseconds; }, at: (value) => { instant = Date.parse(value); } };
}

test('daily backup persists its success and does not repeat on process restart', async (t) => {
  const f = fixture(t);
  const first = createMaintenance(f.options);
  assert.equal(await first.tick(), true);
  assert.equal(f.calls(), 1);
  assert.equal(await first.tick(), false);
  f.advance(HOUR);
  assert.equal(await first.tick(), false);
  await first.stop();
  const restarted = createMaintenance(f.options);
  assert.equal(await restarted.tick(), false);
  assert.equal(f.calls(), 1);
  f.advance(24 * HOUR);
  assert.equal(await restarted.tick(), true);
  assert.equal(f.calls(), 2);
  await restarted.stop();
});

test('backup dates use Europe/Rome midnight rather than UTC midnight', async (t) => {
  const f = fixture(t);
  f.at('2026-10-04T21:30:00Z'); // 23:30 in Rome.
  const maintenance = createMaintenance(f.options);
  await maintenance.tick();
  f.advance(HOUR); // 00:30 in Rome, same UTC calendar day.
  assert.equal(await maintenance.tick(), true);
  assert.equal(f.calls(), 2);
  await maintenance.stop();
});

test('failed backups retry after an hour without marking success or exposing errors', async (t) => {
  const f = fixture(t);
  let attempts = 0;
  f.store.backup = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('PRIVATE_DATA_AND_DATABASE_PATH');
  };
  const maintenance = createMaintenance(f.options);
  assert.equal(await maintenance.tick(), false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0);
  assert.deepEqual(f.errors, ['Daily maintenance failed.']);
  f.advance(HOUR - 1);
  assert.equal(await maintenance.tick(), false);
  assert.equal(attempts, 1);
  f.advance(1);
  assert.equal(await maintenance.tick(), true);
  assert.equal(attempts, 2);
  assert.equal(await maintenance.tick(), false);
  await maintenance.stop();
});

test('scheduler is hourly and unreferenced; stopping waits for the single in-flight snapshot', async (t) => {
  const f = fixture(t);
  let finishBackup;
  let calls = 0;
  f.store.backup = () => { calls += 1; return new Promise((resolve) => { finishBackup = resolve; }); };
  let scheduled;
  let delay;
  let unreferenced = false;
  let cancelled = false;
  const timer = { unref: () => { unreferenced = true; } };
  const maintenance = createMaintenance({ ...f.options,
    schedule(callback, milliseconds) { scheduled = callback; delay = milliseconds; return timer; },
    cancel(value) { assert.equal(value, timer); cancelled = true; },
  });
  const startup = maintenance.start();
  assert.equal(delay, HOUR);
  assert.equal(unreferenced, true);
  assert.equal(maintenance.tick(), startup);
  scheduled();
  assert.equal(calls, 1);
  let stopped = false;
  const stopping = maintenance.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.equal(cancelled, true);
  finishBackup();
  await startup;
  await stopping;
  assert.equal(stopped, true);
  assert.equal(await maintenance.tick(), false);
  assert.equal(calls, 1);
});

test('hourly maintenance removes expired sessions even when today already has a snapshot', async (t) => {
  const f = fixture(t);
  const maintenance = createMaintenance(f.options);
  await maintenance.tick();
  f.db.prepare('INSERT INTO sessions VALUES (?, ?)').run('expired', Date.parse('2026-10-04T08:10:00Z'));
  f.db.prepare('INSERT INTO sessions VALUES (?, ?)').run('valid', Date.parse('2026-10-04T12:00:00Z'));
  f.advance(HOUR);
  assert.equal(await maintenance.tick(), false);
  assert.deepEqual(f.db.prepare('SELECT id_hash FROM sessions').all().map((row) => row.id_hash), ['valid']);
  assert.equal(f.calls(), 1);
  await maintenance.stop();
});
