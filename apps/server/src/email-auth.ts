import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { sqlite } from './db/index.js';
import { createSession, provisionLoginIdentity } from './auth.js';
import { sendVerificationEmail } from './services/mailx.js';

const scrypt = promisify(crypto.scrypt);
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email()
  .regex(/^[a-z0-9][a-z0-9._+%-]*@[a-z0-9.-]+\.[a-z]{2,}$/);
const passwordSchema = z.string().min(12).max(128);
const hashCode = (email: string, token: string, code: string) =>
  crypto.createHmac('sha256', config.EMAIL_CODE_SECRET).update(`${email}\0${token}\0${code}`).digest('hex');
const failure = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

function limit(key: string, max: number, windowMs: number) {
  const time = Date.now();
  return sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM email_auth_limits WHERE resets_at<=?').run(time);
    const row = sqlite.prepare('SELECT count FROM email_auth_limits WHERE key=?').get(key) as
      { count: number } | undefined;
    if (row && row.count >= max) throw failure(429, '操作过于频繁，请稍后重试');
    sqlite
      .prepare(
        `INSERT INTO email_auth_limits(key,count,resets_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1`
      )
      .run(key, time + windowMs);
    return (
      sqlite.prepare('SELECT resets_at FROM email_auth_limits WHERE key=?').get(key) as { resets_at: number }
    ).resets_at;
  })();
}

export async function registerEmailAuth(app: FastifyInstance) {
  const checkEnabled = () => {
    if (config.EMAIL_AUTH_ENABLED !== 'true') throw failure(404, '邮箱登录尚未启用');
  };
  const options = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  app.post('/api/auth/email/code', options, async (request, reply) => {
    checkEnabled();
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    const token = crypto.randomUUID();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const time = Date.now();
    const reservation = sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM email_verifications WHERE expires_at<=?').run(time);
      const previous = sqlite.prepare('SELECT sent_at FROM email_verifications WHERE email=?').get(email) as
        { sent_at: number } | undefined;
      if (previous && time - previous.sent_at < 60_000) throw failure(429, '请等待 60 秒后再发送验证码');
      const ipWindow = limit(`send-ip:${request.ip}`, 10, 3600_000);
      const emailWindow = limit(`send-email:${email}`, 5, 3600_000);
      sqlite
        .prepare(
          `INSERT INTO email_verifications(email,token_id,code_hash,expires_at,sent_at,attempts,ready)
        VALUES(?,?,?,?,?,0,0) ON CONFLICT(email) DO UPDATE SET token_id=excluded.token_id,
        code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,ready=0`
        )
        .run(email, token, hashCode(email, token, code), time + 600_000, time);
      return { ipWindow, emailWindow };
    })();
    try {
      await sendVerificationEmail(email, code);
      sqlite.prepare('UPDATE email_verifications SET ready=1 WHERE email=? AND token_id=?').run(email, token);
    } catch {
      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM email_verifications WHERE email=? AND token_id=?').run(email, token);
        // Refund only this reservation's window, never a newer window's quota.
        const refund = sqlite.prepare(
          'UPDATE email_auth_limits SET count=MAX(0,count-1) WHERE key=? AND resets_at=?'
        );
        refund.run(`send-ip:${request.ip}`, reservation.ipWindow);
        refund.run(`send-email:${email}`, reservation.emailWindow);
      })();
      return reply.code(503).send({ message: '验证码发送失败，请稍后重试' });
    }
    return { message: '验证码已发送，请检查邮箱', retryAfter: 60 };
  });

  app.post('/api/auth/email/register', options, async (request, reply) => {
    checkEnabled();
    const input = z
      .object({
        email: emailSchema,
        password: passwordSchema,
        code: z.string().regex(/^\d{6}$/),
        displayName: z.string().trim().min(1).max(60)
      })
      .parse(request.body);
    limit(`verify-ip:${request.ip}`, 30, 3600_000);
    const row = sqlite.prepare('SELECT * FROM email_verifications WHERE email=?').get(input.email) as
      | { token_id: string; code_hash: string; expires_at: number; attempts: number; ready: number }
      | undefined;
    if (!row || !row.ready || row.expires_at <= Date.now() || row.attempts >= 5)
      throw failure(400, '验证码无效或已过期，请重新获取');
    sqlite.prepare('UPDATE email_verifications SET attempts=attempts+1 WHERE email=?').run(input.email);
    if (
      !crypto.timingSafeEqual(
        Buffer.from(row.code_hash, 'hex'),
        Buffer.from(hashCode(input.email, row.token_id, input.code), 'hex')
      )
    ) {
      throw failure(400, '验证码无效或已过期，请重新获取');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const digest = (await scrypt(input.password, salt, 64)) as Buffer;
    const result = sqlite.transaction(() => {
      // Recheck after the asynchronous password hash: a resend or competing registration wins atomically.
      const consumed = sqlite
        .prepare(
          'DELETE FROM email_verifications WHERE email=? AND token_id=? AND expires_at>? AND attempts<=5 AND ready=1'
        )
        .run(input.email, row.token_id, Date.now());
      if (!consumed.changes) throw failure(400, '验证码无效或已过期，请重新获取');
      if (
        sqlite.prepare("SELECT 1 FROM auth_accounts WHERE provider='email' AND subject=?").get(input.email)
      ) {
        throw failure(409, '该邮箱已注册，请直接登录');
      }
      const identity = provisionLoginIdentity(
        {
          subject: input.email,
          email: input.email,
          emailVerified: true,
          displayName: input.displayName,
          avatarUrl: null
        },
        'email'
      );
      const account = sqlite
        .prepare("SELECT id FROM auth_accounts WHERE provider='email' AND subject=?")
        .get(input.email) as { id: string };
      sqlite
        .prepare('INSERT INTO email_credentials(account_id,password_hash) VALUES(?,?)')
        .run(account.id, `${salt}:${digest.toString('hex')}`);
      return identity;
    })();
    createSession(reply, result.userId, result.sessionWorkspaceId);
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/auth/email/login', options, async (request, reply) => {
    checkEnabled();
    const { email, password } = z
      .object({ email: emailSchema, password: z.string().min(1).max(128) })
      .parse(request.body);
    limit(`login-ip:${request.ip}`, 30, 900_000);
    const failureKey = `login-failure:${JSON.stringify([request.ip, email])}`;
    const failures = sqlite
      .prepare('SELECT count FROM email_auth_limits WHERE key=? AND resets_at>?')
      .get(failureKey, Date.now()) as { count: number } | undefined;
    if (failures && failures.count >= 10) throw failure(429, '操作过于频繁，请稍后重试');
    const account = sqlite
      .prepare(
        `SELECT a.id,a.user_id,a.display_name,c.password_hash FROM auth_accounts a
      JOIN email_credentials c ON c.account_id=a.id WHERE a.provider='email' AND a.subject=?`
      )
      .get(email) as { id: string; user_id: string; display_name: string; password_hash: string } | undefined;
    const [salt, expected] = account?.password_hash.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
    const digest = (await scrypt(password, salt!, 64)) as Buffer;
    if (!account || !crypto.timingSafeEqual(digest, Buffer.from(expected!, 'hex'))) {
      limit(failureKey, 10, 900_000);
      await delay(25 * 2 ** Math.min(failures?.count ?? 0, 3));
      throw failure(401, '邮箱或密码不正确');
    }
    sqlite.transaction(() => {
      const unchanged = sqlite
        .prepare(
          `SELECT 1 FROM auth_accounts a JOIN email_credentials c ON c.account_id=a.id
        WHERE a.id=? AND a.user_id=? AND a.provider='email' AND a.subject=? AND c.password_hash=?`
        )
        .get(account.id, account.user_id, email, account.password_hash);
      if (!unchanged) throw failure(401, '账号信息已变更，请重新登录');
      const result = provisionLoginIdentity(
        { subject: email, email, emailVerified: true, displayName: account.display_name, avatarUrl: null },
        'email'
      );
      if (result.userId !== account.user_id) throw failure(401, '账号信息已变更，请重新登录');
      sqlite.prepare('DELETE FROM email_auth_limits WHERE key=?').run(failureKey);
      createSession(reply, account.user_id, result.sessionWorkspaceId);
    })();
    return { ok: true };
  });
}
