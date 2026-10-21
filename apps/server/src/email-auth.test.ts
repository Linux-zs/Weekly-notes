import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

const mail = vi.hoisted(() => vi.fn());
const hashGate = vi.hoisted(() => ({ next: null as null | { wait: Promise<void>; started: () => void } }));
vi.mock('node:util', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:util')>();
  return {
    ...original,
    promisify: (fn: (...args: unknown[]) => unknown) => {
      const converted = original.promisify(fn) as (...args: unknown[]) => Promise<unknown>;
      if (fn.name !== 'scrypt') return converted;
      return async (...args: unknown[]) => {
        const gate = hashGate.next;
        hashGate.next = null;
        const result = await converted(...args);
        if (gate) {
          gate.started();
          await gate.wait;
        }
        return result;
      };
    }
  };
});
vi.mock('./services/mailx.js', () => ({ sendVerificationEmail: mail }));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-auth-'));
process.env.NODE_ENV = 'test';
process.env.DEV_AUTH_BYPASS = 'false';
process.env.EMAIL_AUTH_ENABLED = 'true';
process.env.EMAIL_CODE_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.DATABASE_PATH = path.join(root, 'test.sqlite');
let app: FastifyInstance;
let sqlite: Database.Database;
let testIp = 0;
const password = 'a long test password 123';
const email = 'signup@example.test';
const post = (route: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/auth/email/${route}`,
    payload,
    remoteAddress: `127.1.0.${testIp}`
  });
const signup = (code: string, target = email) =>
  post('register', { email: target, password, code, displayName: '测试用户' });
beforeAll(async () => {
  app = await (await import('./app.js')).buildApp();
  ({ sqlite } = await import('./db/index.js'));
});
beforeEach(() => {
  testIp++;
  hashGate.next = null;
  mail.mockReset();
  mail.mockResolvedValue(undefined);
  sqlite.exec(
    'DELETE FROM email_auth_limits; DELETE FROM email_verifications; DELETE FROM users; DELETE FROM workspaces;'
  );
});
afterAll(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('verifies registration, hashes credentials, logs in, and rejects replay or bad passwords', async () => {
  expect((await post('code', { email: ' Signup@EXAMPLE.test ' })).statusCode).toBe(200);
  const code = mail.mock.calls[0]![1];
  const stored = sqlite.prepare('SELECT code_hash FROM email_verifications').get() as { code_hash: string };
  expect(stored.code_hash).not.toContain(code);
  const registered = await signup(code);
  expect(registered.statusCode).toBe(201);
  const cookie = String(registered.headers['set-cookie']).split(';')[0]!;
  expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
  const credential = sqlite.prepare('SELECT password_hash FROM email_credentials').get() as {
    password_hash: string;
  };
  expect(credential.password_hash).not.toContain(password);
  expect((await signup(code)).statusCode).toBe(400);
  expect((await post('login', { email, password: 'incorrect' })).statusCode).toBe(401);
  expect((await post('login', { email, password })).statusCode).toBe(200);
  const accounts = (await app.inject({ url: '/api/auth/accounts', headers: { cookie } })).json().accounts;
  expect(accounts[0].provider).toBe('email');
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/auth/accounts/${accounts[0].id}`, headers: { cookie } }))
      .statusCode
  ).toBe(409);
});

it('expires codes, caps attempts, and applies resend cooldown', async () => {
  await post('code', { email });
  const code = mail.mock.calls[0]![1];
  expect((await post('code', { email })).statusCode).toBe(429);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) expect((await signup(wrong)).statusCode).toBe(400);
  expect((await signup(code)).statusCode).toBe(400);
  sqlite.prepare('UPDATE email_verifications SET attempts=0,expires_at=0').run();
  expect((await signup(code)).statusCode).toBe(400);
});

it('invalidates the previous code after resending and allows only one concurrent registration', async () => {
  await post('code', { email });
  sqlite.prepare('UPDATE email_verifications SET sent_at=0').run();
  await post('code', { email });
  const code = mail.mock.calls[1]![1];
  const results = await Promise.all([signup(code), signup(code)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 400]);
  expect(sqlite.prepare('SELECT count(*) AS count FROM email_credentials').get()).toEqual({ count: 1 });
});

it('fails closed on mail errors and rejects invalid recipients and foreign origins', async () => {
  mail.mockRejectedValue(new Error('SMTP unavailable'));
  expect((await post('code', { email })).statusCode).toBe(503);
  expect(sqlite.prepare('SELECT count(*) AS count FROM email_verifications').get()).toEqual({ count: 0 });
  expect((await post('code', { email: '-option@example.test' })).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/email/code',
        headers: { origin: 'https://evil.example' },
        payload: { email }
      })
    ).statusCode
  ).toBe(403);
});

it('keeps existing third-party identities separate even with the same verified email', async () => {
  const { provisionLoginIdentity } = await import('./auth.js');
  const prior = provisionLoginIdentity(
    { subject: 'oidc-user', email, emailVerified: true, displayName: 'Existing', avatarUrl: null },
    'google'
  );
  await post('code', { email });
  expect((await signup(mail.mock.calls[0]![1])).statusCode).toBe(201);
  const next = sqlite.prepare("SELECT user_id FROM auth_accounts WHERE provider='email'").get() as {
    user_id: string;
  };
  expect(next.user_id).not.toBe(prior.userId);
});

it('limits failures by source and email without locking out another source', async () => {
  await post('code', { email });
  await signup(mail.mock.calls[0]![1]);
  for (let i = 0; i < 10; i++)
    expect((await post('login', { email, password: 'wrong' })).statusCode).toBe(401);
  expect((await post('login', { email, password })).statusCode).toBe(429);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/email/login',
        remoteAddress: '127.0.0.8',
        payload: { email, password }
      })
    ).statusCode
  ).toBe(200);
});

it('does not charge cooldown rejections and refunds failed mail delivery', async () => {
  await post('code', { email });
  for (let i = 0; i < 5; i++) expect((await post('code', { email })).statusCode).toBe(429);
  expect(
    sqlite.prepare('SELECT count FROM email_auth_limits WHERE key=?').get(`send-email:${email}`)
  ).toEqual({ count: 1 });
  sqlite.prepare('UPDATE email_verifications SET sent_at=0').run();
  mail.mockRejectedValueOnce(new Error('SMTP failure'));
  expect((await post('code', { email })).statusCode).toBe(503);
  expect(
    sqlite.prepare('SELECT count FROM email_auth_limits WHERE key=?').get(`send-email:${email}`)
  ).toEqual({ count: 1 });
  expect((await post('code', { email })).statusCode).toBe(200);
});

it('does not accumulate successful logins in the failure quota', async () => {
  await post('code', { email });
  await signup(mail.mock.calls[0]![1]);
  for (let i = 0; i < 11; i++) expect((await post('login', { email, password })).statusCode).toBe(200);
  expect(
    sqlite.prepare("SELECT count(*) AS count FROM email_auth_limits WHERE key LIKE 'login-failure:%'").get()
  ).toEqual({ count: 0 });
});

it('rolls back the IP reservation when the email quota is exhausted', async () => {
  sqlite
    .prepare('INSERT INTO email_auth_limits(key,count,resets_at) VALUES(?,5,?)')
    .run(`send-email:${email}`, Date.now() + 3600_000);
  expect((await post('code', { email })).statusCode).toBe(429);
  expect(
    sqlite.prepare('SELECT count FROM email_auth_limits WHERE key=?').get(`send-ip:127.1.0.${testIp}`)
  ).toBeUndefined();
  expect(mail).not.toHaveBeenCalled();
});

it('does not refund a newer quota window after an old delivery fails', async () => {
  let reject!: (error: Error) => void;
  let started!: () => void;
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  mail.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
        started();
      })
  );
  const pending = post('code', { email });
  await reached;
  sqlite.prepare('UPDATE email_auth_limits SET count=3,resets_at=resets_at+3600000').run();
  reject(new Error('late failure'));
  expect((await pending).statusCode).toBe(503);
  expect(
    sqlite.prepare('SELECT count FROM email_auth_limits WHERE key=?').get(`send-email:${email}`)
  ).toEqual({ count: 3 });
});

it.each(['replace', 'password'])(
  'rejects a login when its account changes during hashing: %s',
  async (change) => {
    await post('code', { email });
    const registered = await signup(mail.mock.calls[0]![1]);
    const cookie = String(registered.headers['set-cookie']).split(';')[0]!;
    const user = (await app.inject({ url: '/api/me', headers: { cookie } })).json().user;
    const { provisionLoginIdentity } = await import('./auth.js');
    provisionLoginIdentity(
      {
        subject: 'fallback',
        email: 'fallback@example.test',
        emailVerified: true,
        displayName: 'Fallback',
        avatarUrl: null
      },
      'google',
      user.id
    );
    let release!: () => void;
    let started!: () => void;
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    hashGate.next = {
      wait: new Promise<void>((resolve) => {
        release = resolve;
      }),
      started
    };
    const pending = post('login', { email, password });
    await reached;
    try {
      if (change === 'replace') {
        const account = sqlite.prepare("SELECT id FROM auth_accounts WHERE provider='email'").get() as {
          id: string;
        };
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: `/api/auth/accounts/${account.id}`,
              headers: { cookie }
            })
          ).statusCode
        ).toBe(204);
        await post('code', { email });
        expect(
          (
            await post('register', {
              email,
              code: mail.mock.calls[1]![1],
              password: 'different password 123',
              displayName: 'Replacement'
            })
          ).statusCode
        ).toBe(201);
      } else sqlite.prepare("UPDATE email_credentials SET password_hash='changed'").run();
    } finally {
      release();
    }
    const result = await pending;
    expect(result.statusCode).toBe(401);
    expect(result.headers['set-cookie']).toBeUndefined();
  }
);

it('joins a valid invitation only after email verification and prevents duplicate registration', async () => {
  const { provisionLoginIdentity } = await import('./auth.js');
  const owner = provisionLoginIdentity(
    {
      subject: 'owner',
      email: 'owner@example.test',
      emailVerified: true,
      displayName: 'Owner',
      avatarUrl: null
    },
    'google'
  );
  const workspace = sqlite
    .prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?')
    .get(owner.userId) as { workspace_id: string };
  sqlite
    .prepare(
      `INSERT INTO workspace_invitations(id,workspace_id,email,role,status,invited_by,expires_at,created_at)
    VALUES('invite',?,?,'member','pending',?,?,?)`
    )
    .run(
      workspace.workspace_id,
      email,
      owner.userId,
      new Date(Date.now() + 3600_000).toISOString(),
      new Date().toISOString()
    );
  await post('code', { email });
  const response = await signup(mail.mock.calls[0]![1]);
  expect(response.statusCode).toBe(201);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const me = (await app.inject({ url: '/api/me', headers: { cookie } })).json().user;
  expect(me.workspaceId).toBe(workspace.workspace_id);
  expect(me.role).toBe('member');
  await post('code', { email });
  expect((await signup(mail.mock.calls[1]![1])).statusCode).toBe(409);
});

it('does not expose email auth when disabled', async () => {
  const { config } = await import('./config.js');
  config.EMAIL_AUTH_ENABLED = 'false';
  try {
    expect((await post('code', { email })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/auth/providers' })).json().emailAuthEnabled).toBe(false);
    expect(mail).not.toHaveBeenCalled();
  } finally {
    config.EMAIL_AUTH_ENABLED = 'true';
  }
});
