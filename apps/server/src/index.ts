import { buildApp } from './app.js';
import { config } from './config.js';
import { scheduleBackups } from './services/backup.js';

const app=await buildApp();
await app.listen({port:config.PORT,host:'0.0.0.0'});
scheduleBackups(app.log);

const shutdown=async()=>{await app.close();process.exit(0);};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
