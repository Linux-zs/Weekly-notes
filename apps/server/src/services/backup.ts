import { promises as files } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';
import { withStorageLock } from './storage.js';

const retentionMs = 30 * 86_400_000;
const retryDelayMs = 15 * 60_000;
let backupRunning = false;
let nextAttemptAt = 0;

function safeBackupPath(root: string, relative: string) {
  const target = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error(`INVALID_BACKUP_FILE_PATH:${relative}`);
  return target;
}

function backupReferences(databasePath: string) {
  const backup = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const attachments = backup
      .prepare('SELECT stored_name AS storedName FROM report_attachments')
      .all() as Array<{
      storedName: string;
    }>;
    const avatars = backup
      .prepare("SELECT avatar_url AS avatarUrl FROM users WHERE avatar_url LIKE '/api/profile-avatars/%'")
      .all() as Array<{ avatarUrl: string }>;
    const files = [
      ...attachments.map((entry) => entry.storedName),
      ...avatars.map((entry) => path.join('avatars', entry.avatarUrl.split('/').pop()!))
    ];
    return { files, attachments: attachments.length, avatars: avatars.length, verifiedFiles: files.length };
  } finally {
    backup.close();
  }
}

async function pruneBackups(log?: FastifyBaseLogger) {
  const cutoff = Date.now() - retentionMs;
  try {
    for (const entry of await files.readdir(config.backupDir, { withFileTypes: true })) {
      if (!entry.name.startsWith('zhoubao-') || entry.name.endsWith('.tmp')) continue;
      const target = path.join(config.backupDir, entry.name);
      if ((await files.stat(target)).mtimeMs < cutoff)
        await files.rm(target, { recursive: entry.isDirectory(), force: true });
    }
  } catch (error) {
    log?.warn({ err: error }, 'Backup retention cleanup failed');
  }
}

export async function createBackup(log?: FastifyBaseLogger) {
  await files.mkdir(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(config.backupDir, `zhoubao-${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  const staging = `${destination}-${crypto.randomUUID()}.tmp`;
  const pins = path.join(config.uploadDir, `.backup-pins-${crypto.randomUUID()}`);
  await files.mkdir(staging, { recursive: false });
  try {
    const databasePath = path.join(staging, 'zhoubao.sqlite');
    const references = await withStorageLock(async () => {
      await sqlite.backup(databasePath);
      const references = backupReferences(databasePath);
      await files.mkdir(pins, { recursive: true });
      // Uploads are immutable UUID-named files. Same-volume hard links preserve
      // snapshot contents even when a subsequent request deletes the originals.
      for (const relative of new Set(references.files)) {
        const pinned = safeBackupPath(pins, relative);
        await files.mkdir(path.dirname(pinned), { recursive: true });
        try {
          await files.link(safeBackupPath(config.uploadDir, relative), pinned);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new Error(`BACKUP_FILES_MISSING:${relative}`, { cause: error });
          throw error;
        }
      }
      return references;
    });
    const uploadsDestination = path.join(staging, 'uploads');
    await files.cp(pins, uploadsDestination, { recursive: true, errorOnExist: true });
    for (const relative of references.files) await files.access(safeBackupPath(uploadsDestination, relative));
    const { files: referencedFiles, ...integrity } = references;
    await files.writeFile(
      path.join(staging, 'manifest.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          database: 'zhoubao.sqlite',
          uploads: 'uploads',
          integrity: { verified: true, ...integrity },
          fileCount: referencedFiles.length
        },
        null,
        2
      )
    );
    await files.rename(staging, destination);
  } catch (error) {
    await files.rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await files.rm(pins, { recursive: true, force: true });
  }
  await pruneBackups(log);
  return destination;
}

function claimDailyBackup(day: string) {
  return sqlite.transaction(() => {
    const completed = sqlite.prepare('SELECT value FROM app_state WHERE key=?').get('last_daily_backup') as
      { value: string } | undefined;
    if (completed?.value === day) return false;
    const claim = sqlite.prepare('SELECT value FROM app_state WHERE key=?').get('daily_backup_claim') as
      { value: string } | undefined;
    if (claim) {
      try {
        const parsed = JSON.parse(claim.value) as { day: string; startedAt: number };
        if (parsed.day === day && Date.now() - parsed.startedAt < 60 * 60_000) return false;
      } catch {
        // Invalid or stale claims are replaced below.
      }
    }
    sqlite
      .prepare(
        'INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      )
      .run('daily_backup_claim', JSON.stringify({ day, startedAt: Date.now() }));
    return true;
  })();
}

export async function runScheduledBackup(log: FastifyBaseLogger, current = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(current);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false
    }).format(current)
  );
  if (hour < 3 || backupRunning || Date.now() < nextAttemptAt || !claimDailyBackup(day)) return false;
  backupRunning = true;
  try {
    const file = await createBackup(log);
    sqlite.transaction(() => {
      sqlite
        .prepare(
          'INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
        )
        .run('last_daily_backup', day);
      sqlite.prepare('DELETE FROM app_state WHERE key=?').run('daily_backup_claim');
    })();
    nextAttemptAt = 0;
    log.info({ file }, 'Daily data backup complete');
    return true;
  } catch (error) {
    sqlite.prepare('DELETE FROM app_state WHERE key=?').run('daily_backup_claim');
    nextAttemptAt = Date.now() + retryDelayMs;
    log.error({ err: error }, 'Daily data backup failed');
    return false;
  } finally {
    backupRunning = false;
  }
}

export function scheduleBackups(log: FastifyBaseLogger) {
  setInterval(() => void runScheduledBackup(log), 60_000).unref();
}
