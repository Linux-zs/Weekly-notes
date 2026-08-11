import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

export async function createBackup() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(config.backupDir, `zhoubao-${stamp}`);
  fs.mkdirSync(destination, { recursive: false });
  try {
    await sqlite.backup(path.join(destination, 'zhoubao.sqlite'));
    const uploadsDestination = path.join(destination, 'uploads');
    if (fs.existsSync(config.uploadDir))
      fs.cpSync(config.uploadDir, uploadsDestination, { recursive: true, errorOnExist: true });
    else fs.mkdirSync(uploadsDestination, { recursive: true });
    fs.writeFileSync(
      path.join(destination, 'manifest.json'),
      JSON.stringify(
        { createdAt: new Date().toISOString(), database: 'zhoubao.sqlite', uploads: 'uploads' },
        null,
        2
      )
    );
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const entry of fs.readdirSync(config.backupDir, { withFileTypes: true }))
    if (entry.name.startsWith('zhoubao-')) {
      const target = path.join(config.backupDir, entry.name);
      if (fs.statSync(target).mtimeMs < cutoff)
        fs.rmSync(target, { recursive: entry.isDirectory(), force: true });
    }
  return destination;
}

export function scheduleBackups(log: FastifyBaseLogger) {
  setInterval(async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false
    }).format(new Date());
    if (hour !== '03') return;
    const key = 'last_daily_backup';
    const claimed = sqlite.transaction(() => {
      const current = sqlite.prepare('SELECT value FROM app_state WHERE key=?').get(key) as
        { value: string } | undefined;
      if (current?.value === day) return false;
      sqlite
        .prepare(
          'INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
        )
        .run(key, day);
      return true;
    })();
    if (!claimed) return;
    try {
      const file = await createBackup();
      log.info({ file }, 'Daily data backup complete');
    } catch (error) {
      sqlite.prepare('DELETE FROM app_state WHERE key=? AND value=?').run(key, day);
      log.error({ err: error }, 'Daily data backup failed');
    }
  }, 60_000).unref();
}
