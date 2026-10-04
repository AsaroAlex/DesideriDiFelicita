import { toLocalParts } from './time.mjs';

const BACKUP_DATE_KEY = 'maintenance_backup_date';
const HOURLY = 60 * 60 * 1000;

export function createMaintenance({
  store,
  now = Date.now,
  intervalMs = HOURLY,
  logError = () => console.error('Daily maintenance failed.'),
  schedule = setInterval,
  cancel = clearInterval,
}) {
  const readDate = store.db.prepare('SELECT value FROM settings WHERE key = ?');
  const writeDate = store.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const purgeSessions = store.db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  let timer;
  let inFlight;
  let stopped = false;
  let retryAt = 0;

  function lastSuccessDate() {
    const saved = readDate.get(BACKUP_DATE_KEY);
    if (!saved) return null;
    try {
      const date = JSON.parse(saved.value);
      return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    } catch { return null; }
  }

  function tick() {
    if (stopped) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const instant = now();
      if (instant < retryAt) return false;
      try {
        purgeSessions.run(instant);
        const day = toLocalParts(instant).date;
        if (lastSuccessDate() === day) return false;
        await store.backup();
        // Persist only after a complete snapshot; a failed backup remains eligible.
        writeDate.run(BACKUP_DATE_KEY, JSON.stringify(day));
        retryAt = 0;
        return true;
      } catch {
        retryAt = now() + intervalMs;
        // Never log database paths, user records, provider details, or raw errors.
        logError();
        return false;
      }
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return {
    tick,
    start() {
      if (stopped) return Promise.resolve(false);
      if (!timer) {
        timer = schedule(() => { void tick(); }, intervalMs);
        timer.unref?.();
      }
      return tick();
    },
    async stop() {
      stopped = true;
      if (timer) cancel(timer);
      timer = undefined;
      if (inFlight) await inFlight;
    },
  };
}
