import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { SignJWT, decodeJwt, importPKCS8 } from 'jose';
import { config } from './config.js';
import { id, now, sqlite } from './db/index.js';
import type { AuthProvider } from '@zhoubao/shared';

const FLOW_COOKIE = 'zhoubao_auth_flow';
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

type Flow = { id: string; provider: AuthProvider; state: string; verifier: string | null; nonce: string | null; link_user_id: string | null; expires_at: string; };
type Identity = { subject: string; email: string | null; emailVerified: boolean; displayName: string; avatarUrl: string | null; };

function callbackUrl(provider: AuthProvider) { return `${config.APP_ORIGIN}/auth/${provider}/callback`; }
function cookieOptions(path = '/') { return { path, httpOnly: true, secure: config.isProduction, sameSite: 'lax' as const }; }

async function appleSecret() {
  const key = await importPKCS8(config.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.APPLE_KEY_ID })
    .setIssuer(config.APPLE_TEAM_ID).setSubject(config.APPLE_CLIENT_ID)
    .setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('180d').sign(key);
}

async function providerConfig(provider: AuthProvider) {
  if (provider === 'google') return oidc.discovery(new URL('https://accounts.google.com'), config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET);
  if (provider === 'microsoft') return oidc.discovery(new URL('https://login.microsoftonline.com/common/v2.0'), config.MICROSOFT_CLIENT_ID, config.MICROSOFT_CLIENT_SECRET);
  if (provider === 'apple') return oidc.discovery(new URL('https://appleid.apple.com'), config.APPLE_CLIENT_ID, await appleSecret());
  throw new Error('GitHub does not expose OpenID Connect for user login');
}

function enabled(provider: AuthProvider) {
  if (provider === 'google') return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
  if (provider === 'microsoft') return Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET);
  if (provider === 'github') return Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
  return config.appleEnabled && Boolean(config.APPLE_CLIENT_ID && config.APPLE_PRIVATE_KEY);
}

function createSession(reply: FastifyReply, userId: string) {
  const raw = randomToken();
  const timestamp = now();
  const expires = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
  sqlite.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)')
    .run(id(), userId, sha256(raw), expires.toISOString(), timestamp, timestamp);
  reply.setCookie(config.SESSION_COOKIE_NAME, raw, { ...cookieOptions('/'), expires });
}

function createOwner(identity: Identity, provider: AuthProvider) {
  const userId = id(); const workspaceId = id(); const timestamp = now();
  sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO users(id,display_name,email,avatar_url,timezone,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(userId, identity.displayName, identity.email, identity.avatarUrl, 'Asia/Shanghai', timestamp, timestamp);
    sqlite.prepare('INSERT INTO workspaces(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(workspaceId, '我的周报', 'personal', timestamp, timestamp);
    sqlite.prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)')
      .run(workspaceId, userId, 'owner', timestamp);
    sqlite.prepare('INSERT INTO auth_accounts(id,user_id,provider,subject,email,display_name,last_login_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(), userId, provider, identity.subject, identity.email, identity.displayName, timestamp, timestamp);
    sqlite.prepare("INSERT INTO app_state(key,value) VALUES('owner_initialized','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  })();
  return userId;
}

async function resolveIdentity(provider: AuthProvider, flow: Flow, request: FastifyRequest): Promise<Identity> {
  const values = { ...request.query as Record<string,string>, ...request.body as Record<string,string> };
  if (provider === 'github') {
    if (values.state !== flow.state || !values.code) throw new Error('Invalid OAuth state');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.GITHUB_CLIENT_ID, client_secret: config.GITHUB_CLIENT_SECRET, code: values.code, redirect_uri: callbackUrl(provider) })
    });
    const token = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!token.access_token) throw new Error(token.error ?? 'GitHub token exchange failed');
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'zhoubao' };
    const [userResponse, emailsResponse] = await Promise.all([
      fetch('https://api.github.com/user', { headers }), fetch('https://api.github.com/user/emails', { headers })
    ]);
    const user = await userResponse.json() as { id: number; name: string | null; login: string; avatar_url: string | null; email: string | null };
    const emails = emailsResponse.ok ? await emailsResponse.json() as Array<{email:string;primary:boolean;verified:boolean}> : [];
    const primary = emails.find((email) => email.primary && email.verified);
    return { subject: String(user.id), email: primary?.email ?? user.email, emailVerified: Boolean(primary ?? user.email), displayName: user.name ?? user.login, avatarUrl: user.avatar_url };
  }

  const configuration = await providerConfig(provider);
  const receivedUrl = new URL(callbackUrl(provider));
  Object.entries(values).forEach(([key, value]) => { if (typeof value === 'string') receivedUrl.searchParams.set(key, value); });
  const tokens = await oidc.authorizationCodeGrant(configuration, receivedUrl, {
    pkceCodeVerifier: flow.verifier ?? undefined, expectedState: flow.state, expectedNonce: flow.nonce ?? undefined
  });
  if (!tokens.id_token) throw new Error('Provider did not return an ID token');
  const claims = decodeJwt(tokens.id_token);
  return {
    subject: String(claims.sub), email: typeof claims.email === 'string' ? claims.email : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    displayName: typeof claims.name === 'string' ? claims.name : (typeof claims.email === 'string' ? claims.email.split('@')[0]! : provider),
    avatarUrl: typeof claims.picture === 'string' ? claims.picture : null
  };
}

function finishIdentity(identity: Identity, provider: AuthProvider, flow: Flow, reply: FastifyReply) {
  const existing = sqlite.prepare('SELECT user_id FROM auth_accounts WHERE provider=? AND subject=?').get(provider, identity.subject) as { user_id: string } | undefined;
  let userId = existing?.user_id;
  if (flow.link_user_id) {
    if (existing && existing.user_id !== flow.link_user_id) throw new Error('该身份已绑定其他账号');
    userId = flow.link_user_id;
    sqlite.prepare(`INSERT INTO auth_accounts(id,user_id,provider,subject,email,display_name,last_login_at,created_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider,subject) DO UPDATE SET last_login_at=excluded.last_login_at,email=excluded.email,display_name=excluded.display_name`)
      .run(id(), userId, provider, identity.subject, identity.email, identity.displayName, now(), now());
  } else if (!userId) {
    const initialized = sqlite.prepare("SELECT value FROM app_state WHERE key='owner_initialized'").get() as {value:string}|undefined;
    const bootstrapAllowed = !initialized && provider === 'google' && identity.emailVerified && identity.email?.toLowerCase() === config.OWNER_BOOTSTRAP_EMAIL.toLowerCase();
    if (!bootstrapAllowed) throw new Error('该账号未获授权');
    userId = createOwner(identity, provider);
  } else {
    sqlite.prepare('UPDATE auth_accounts SET last_login_at=? WHERE provider=? AND subject=?').run(now(), provider, identity.subject);
  }
  createSession(reply, userId);
}

export async function registerAuth(app: FastifyInstance) {
  app.decorateRequest('currentUser', null);
  app.addHook('preHandler', async (request) => {
    request.currentUser = null;
    const raw = request.cookies[config.SESSION_COOKIE_NAME];
    if (!raw) return;
    const row = sqlite.prepare(`SELECT u.id,u.display_name,u.email,u.avatar_url,wm.workspace_id,wm.role
      FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspace_members wm ON wm.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>? ORDER BY wm.created_at LIMIT 1`).get(sha256(raw), now()) as any;
    if (!row) return;
    request.currentUser = { id: row.id, displayName: row.display_name, email: row.email, avatarUrl: row.avatar_url, workspaceId: row.workspace_id, role: row.role };
    sqlite.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(now(), sha256(raw));
  });

  app.get('/api/auth/providers', async () => ({ providers: (['google','microsoft','github','apple'] as AuthProvider[]).map((provider) => ({ provider, enabled: enabled(provider) })) }));
  app.get('/api/auth/accounts', async (request, reply) => {
    if (!request.currentUser) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return { accounts: sqlite.prepare('SELECT id,provider,email,display_name AS displayName,last_login_at AS lastLoginAt FROM auth_accounts WHERE user_id=? ORDER BY created_at').all(request.currentUser.id) };
  });

  app.get('/auth/:provider/start', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (request, reply) => startFlow(request, reply, false));
  app.get('/api/auth/accounts/:provider/link', async (request, reply) => {
    if (!request.currentUser) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return startFlow(request, reply, true);
  });

  for (const method of ['GET', 'POST'] as const) {
    app.route({ method, url: '/auth/:provider/callback', handler: async (request, reply) => {
      const provider = (request.params as {provider:string}).provider as AuthProvider;
      const flowId = request.cookies[FLOW_COOKIE];
      const flow = flowId ? sqlite.prepare('SELECT * FROM auth_flows WHERE id=? AND expires_at>?').get(flowId, now()) as Flow|undefined : undefined;
      if (!flow || flow.provider !== provider) return reply.code(400).type('text/plain').send('登录流程已过期，请重新开始。');
      try {
        const identity = await resolveIdentity(provider, flow, request);
        finishIdentity(identity, provider, flow, reply);
        sqlite.prepare('DELETE FROM auth_flows WHERE id=?').run(flow.id);
        reply.clearCookie(FLOW_COOKIE, cookieOptions('/auth'));
        return reply.redirect(flow.link_user_id ? '/settings?linked=1' : '/');
      } catch (error) {
        request.log.warn({ err: error, provider }, 'Authentication callback failed');
        return reply.redirect('/login?error=access_denied');
      }
    }});
  }

  app.delete('/api/auth/accounts/:provider', async (request, reply) => {
    if (!request.currentUser) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const provider = (request.params as {provider:string}).provider;
    const count = sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts WHERE user_id=?').get(request.currentUser.id) as {count:number};
    if (count.count <= 1) return reply.code(409).send({ error: 'LAST_ACCOUNT', message: '不能解绑最后一个登录方式' });
    sqlite.prepare('DELETE FROM auth_accounts WHERE user_id=? AND provider=?').run(request.currentUser.id, provider);
    return reply.code(204).send();
  });

  app.post('/auth/logout', async (request, reply) => {
    const raw = request.cookies[config.SESSION_COOKIE_NAME];
    if (raw) sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(raw));
    reply.clearCookie(config.SESSION_COOKIE_NAME, cookieOptions('/'));
    return reply.code(204).send();
  });

  app.get('/auth/dev', async (_request, reply) => {
    if (!config.devAuthBypass || config.isProduction) return reply.code(404).send();
    let user = sqlite.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as {id:string}|undefined;
    if (!user) user = { id: createOwner({ subject: 'dev-owner', email: config.OWNER_BOOTSTRAP_EMAIL, emailVerified: true, displayName: '周报主人', avatarUrl: null }, 'google') };
    createSession(reply, user.id);
    return reply.redirect('/');
  });
}

async function startFlow(request: FastifyRequest, reply: FastifyReply, link: boolean) {
  const provider = (request.params as {provider:string}).provider as AuthProvider;
  if (!['google','microsoft','github','apple'].includes(provider) || !enabled(provider)) return reply.code(404).send({ error: 'PROVIDER_DISABLED' });
  if (link && !request.currentUser) return reply.code(401).send({ error: 'UNAUTHORIZED' });
  const flow: Flow = { id: id(), provider, state: oidc.randomState(), verifier: provider === 'github' ? null : oidc.randomPKCECodeVerifier(), nonce: provider === 'github' ? null : oidc.randomNonce(), link_user_id: link ? request.currentUser!.id : null, expires_at: new Date(Date.now()+600_000).toISOString() };
  sqlite.prepare('INSERT INTO auth_flows(id,provider,state,verifier,nonce,link_user_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(flow.id, provider, flow.state, flow.verifier, flow.nonce, flow.link_user_id, flow.expires_at, now());
  reply.setCookie(FLOW_COOKIE, flow.id, { ...cookieOptions('/auth'), maxAge: 600 });
  if (provider === 'github') {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: config.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(provider), scope: 'read:user user:email', state: flow.state }).toString();
    return reply.redirect(url.href);
  }
  const configuration = await providerConfig(provider);
  const challenge = await oidc.calculatePKCECodeChallenge(flow.verifier!);
  const params: Record<string,string> = { redirect_uri: callbackUrl(provider), scope: 'openid profile email', state: flow.state, nonce: flow.nonce!, code_challenge: challenge, code_challenge_method: 'S256' };
  if (provider === 'apple') params.response_mode = 'form_post';
  return reply.redirect(oidc.buildAuthorizationUrl(configuration, params).href);
}
