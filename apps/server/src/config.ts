import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default('http://127.0.0.1:3000'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  DATABASE_PATH: z.string().default('./data/zhoubao.sqlite'),
  BACKUP_DIR: z.string().default('./data/backups'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  HOLIDAY_DATA_DIR: z.string().default('./data/holidays'),
  SESSION_COOKIE_NAME: z.string().default('zhoubao_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DEV_AUTH_BYPASS: z.enum(['true', 'false']).default('false'),
  EMAIL_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
  EMAIL_CODE_SECRET: z.string().default(''),
  MAILX_PATH: z.string().min(1).default('mailx'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  MICROSOFT_CLIENT_ID: z.string().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default('')
});

const parsed = envSchema.parse(process.env);
if (parsed.EMAIL_AUTH_ENABLED === 'true' && parsed.EMAIL_CODE_SECRET.length < 32) {
  throw new Error('EMAIL_CODE_SECRET must contain at least 32 characters when email auth is enabled');
}
export const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
if (parsed.NODE_ENV === 'production' && parsed.DEV_AUTH_BYPASS === 'true') {
  throw new Error('DEV_AUTH_BYPASS must be false in production');
}

export const config = {
  ...parsed,
  isProduction: parsed.NODE_ENV === 'production',
  // Supported deployment has exactly one trusted reverse proxy in front of the app.
  trustProxy: parsed.TRUST_PROXY === 'true' ? 1 : false,
  devAuthBypass: parsed.DEV_AUTH_BYPASS === 'true',
  databasePath: path.resolve(workspaceRoot, parsed.DATABASE_PATH),
  backupDir: path.resolve(workspaceRoot, parsed.BACKUP_DIR),
  uploadDir: path.resolve(workspaceRoot, parsed.UPLOAD_DIR),
  holidayDataDir: path.resolve(workspaceRoot, parsed.HOLIDAY_DATA_DIR)
};
