import { buildApp } from './app.js';
import { config } from './config.js';
import { scheduleBackups } from './services/backup.js';
import { scheduleMaintenance } from './services/maintenance.js';

const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
scheduleBackups(app.log);
scheduleMaintenance(app.log);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
