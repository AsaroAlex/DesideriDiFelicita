import { pathToFileURL } from 'node:url';
import { createApp } from './http.mjs';
import { createMaintenance } from './maintenance.mjs';

export { createApp } from './http.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createConfig } = await import('./config.mjs');
  const app = createApp({ config: createConfig() });
  await app.start();
  const maintenance = createMaintenance({ store: app.store });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      try { await maintenance.stop(); }
      finally { await app.close(); }
    }
    catch { console.error('Application shutdown failed.'); process.exitCode = 1; }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  await maintenance.start();
  if (!stopping) console.log('Application ready.');
}
