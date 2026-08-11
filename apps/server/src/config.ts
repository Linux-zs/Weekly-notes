import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default('http://127.0.0.1:3000'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  DATABASE_PATH: z.string().default('./data/zhoubao.sqlite'),
  BACKUP_DIR: z.string().default('./data/backups'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  HOLIDAY_DATA_DIR: z.string().default('./data/holidays'),
  SESSION_COOKIE_NAME: z.string().default('zhoubao_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  OWNER_BOOTSTRAP_EMAIL: z.string().email().default('owner@example.com'),
  DEV_AUTH_BYPASS: z.enum(['true', 'false']).default('true'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  MICROSOFT_CLIENT_ID: z.string().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  APPLE_ENABLED: z.enum(['true', 'false']).default('false'),
  APPLE_CLIENT_ID: z.string().default(''),
  APPLE_TEAM_ID: z.string().default(''),
  APPLE_KEY_ID: z.string().default(''),
  APPLE_PRIVATE_KEY: z.string().default('')
});

const parsed = envSchema.parse(process.env);
export const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
if (parsed.NODE_ENV === 'production' && parsed.DEV_AUTH_BYPASS === 'true') {
  throw new Error('DEV_AUTH_BYPASS must be false in production');
}

export const config = {
  ...parsed,
  isProduction: parsed.NODE_ENV === 'production',
  trustProxy: parsed.TRUST_PROXY === 'true',
  devAuthBypass: parsed.DEV_AUTH_BYPASS === 'true',
  appleEnabled: parsed.APPLE_ENABLED === 'true',
  databasePath: path.resolve(workspaceRoot, parsed.DATABASE_PATH),
  backupDir: path.resolve(workspaceRoot, parsed.BACKUP_DIR),
  uploadDir: path.resolve(workspaceRoot, parsed.UPLOAD_DIR),
  holidayDataDir: path.resolve(workspaceRoot, parsed.HOLIDAY_DATA_DIR)
};
