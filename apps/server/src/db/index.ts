import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { runMigrations } from './migrate.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
runMigrations(sqlite);

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
