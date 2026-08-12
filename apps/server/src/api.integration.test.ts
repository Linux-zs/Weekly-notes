import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhoubao-api-'));
process.env.NODE_ENV = 'test';
process.env.DEV_AUTH_BYPASS = 'true';
process.env.DATABASE_PATH = path.join(testRoot, 'test.sqlite');
process.env.BACKUP_DIR = path.join(testRoot, 'backups');
process.env.UPLOAD_DIR = path.join(testRoot, 'uploads');
process.env.APP_ORIGIN = 'http://127.0.0.1:3000';

let app: FastifyInstance;
let sqlite: Database.Database;
let cookie = '';
beforeAll(async () => {
  const module = await import('./app.js');
  app = await module.buildApp();
  ({ sqlite } = await import('./db/index.js'));
  const login = await app.inject({ method: 'GET', url: '/auth/dev' });
  const setCookie = login.headers['set-cookie'];
  const firstCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!firstCookie) throw new Error('开发登录未返回会话 Cookie');
  cookie = firstCookie.split(';', 1)[0] ?? '';
});
afterAll(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

const headers = () => ({ cookie, origin: 'http://127.0.0.1:3000' });

describe('authenticated weekly report workflow', () => {
  it('provisions an uninvited external identity with a personal workspace', async () => {
    const { provisionLoginIdentity } = await import('./auth.js');
    const subject = `microsoft-${crypto.randomUUID()}`;
    const before = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const provisioned = provisionLoginIdentity(
      {
        subject,
        email: 'new-user@example.com',
        emailVerified: false,
        displayName: '新用户',
        avatarUrl: null
      },
      'microsoft'
    );

    const membership = sqlite
      .prepare(
        'SELECT wm.role,w.type FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=?'
      )
      .get(provisioned.userId) as { role: string; type: string };
    expect(membership).toEqual({ role: 'owner', type: 'personal' });
    expect(provisioned.sessionWorkspaceId).toBeUndefined();

    const repeated = provisionLoginIdentity(
      {
        subject,
        email: 'new-user@example.com',
        emailVerified: false,
        displayName: '新用户',
        avatarUrl: null
      },
      'microsoft'
    );
    const after = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    expect(repeated.userId).toBe(provisioned.userId);
    expect(after.count).toBe(before.count + 1);
  });

  it('does not retain the removed work material storage or API', async () => {
    const retiredTables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memo_cards','memo_card_tags')"
      )
      .all();
    expect(retiredTables).toEqual([]);
    const retiredEndpoint = await app.inject({
      method: 'GET',
      url: '/api/memos',
      headers: headers()
    });
    expect(retiredEndpoint.statusCode).toBe(404);
  });

  it('creates, updates, and searches report content transactionally', async () => {
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(),
      payload: { name: '集成测试项目', color: '#456990' }
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json().id;
    const tag = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: headers(),
      payload: { name: '测试', color: '#78909C' }
    });
    expect(tag.statusCode).toBe(201);
    const tagId = tag.json().id;
    const report = await app.inject({
      method: 'PUT',
      url: '/api/reports/2026/33',
      headers: headers(),
      payload: {}
    });
    expect(report.statusCode).toBe(200);
    const reportId = report.json().id;
    const item = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/items`,
      headers: headers(),
      payload: { type: 'completed', contentMd: '完成 API 集成测试', projectId, tagIds: [tagId] }
    });
    expect(item.statusCode).toBe(201);
    expect(item.json()).toMatchObject({ progress: 'completed', note: '', version: 1 });
    const metadata = await app.inject({
      method: 'PATCH',
      url: `/api/report-items/${item.json().id}`,
      headers: headers(),
      payload: { progress: 'answered', note: '等待领导确认', expectedVersion: 1 }
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({ progress: 'answered', note: '等待领导确认', version: 2 });
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/report-items/${item.json().id}`,
      headers: headers(),
      payload: { note: '旧版本覆盖', expectedVersion: 1 }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().current).toMatchObject({
      id: item.json().id,
      progress: 'answered',
      note: '等待领导确认',
      version: 2
    });
    const boundary = 'zhoubao-image-boundary';
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/report-items/${item.json().id}/images`,
      headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart
    });
    expect(uploaded.statusCode).toBe(201);
    const attachment = await app.inject({ method: 'GET', url: uploaded.json().url, headers: { cookie } });
    expect(attachment.statusCode).toBe(200);
    expect(attachment.headers['content-type']).toContain('image/png');
    const backupResponse = await app.inject({
      method: 'POST',
      url: '/api/settings/backup',
      headers: headers()
    });
    expect(backupResponse.statusCode).toBe(404);
    const { createBackup } = await import('./services/backup.js');
    const backup = await createBackup();
    expect(fs.existsSync(path.join(backup, 'zhoubao.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(backup, 'manifest.json'))).toBe(true);
    expect(
      fs
        .readdirSync(path.join(backup, 'uploads'), { recursive: true })
        .some((entry) => String(entry).endsWith('.png'))
    ).toBe(true);
    const holidayImport = await app.inject({
      method: 'POST',
      url: '/api/settings/holidays/2026/import',
      headers: headers()
    });
    expect(holidayImport.statusCode).toBe(404);
    const { importHolidayYear } = await import('./services/holidays.js');
    expect(importHolidayYear(2026)).toMatchObject({ year: 2026, count: 39 });
    const attachmentList = await app.inject({
      method: 'GET',
      url: `/api/report-items/${item.json().id}/attachments`,
      headers: headers()
    });
    expect(attachmentList.statusCode).toBe(200);
    expect(attachmentList.json().attachments).toHaveLength(1);
    const attachmentDelete = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${uploaded.json().id}`,
      headers: headers()
    });
    expect(attachmentDelete.statusCode).toBe(204);
    const reportWeeks = await app.inject({
      method: 'GET',
      url: '/api/report-weeks/2026',
      headers: headers()
    });
    expect(reportWeeks.statusCode).toBe(200);
    expect(reportWeeks.json().weeks).toContainEqual({ weekNumber: 33, itemCount: 1 });
    const search = await app.inject({ method: 'GET', url: '/api/search?q=API', headers: headers() });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(1);
    const renamedTag = await app.inject({
      method: 'PATCH',
      url: `/api/tags/${tagId}`,
      headers: headers(),
      payload: { name: '已验证', color: '#2F5597' }
    });
    expect(renamedTag.statusCode).toBe(200);
    expect(renamedTag.json()).toMatchObject({ name: '已验证', color: '#2F5597' });
  });

  it('uploads and serves a custom profile avatar', async () => {
    const boundary = 'zhoubao-avatar-boundary';
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/settings/avatar',
      headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().avatarUrl).toMatch(/^\/api\/profile-avatars\/[0-9a-f-]+\.png$/);
    const avatar = await app.inject({
      method: 'GET',
      url: uploaded.json().avatarUrl,
      headers: { cookie }
    });
    expect(avatar.statusCode).toBe(200);
    expect(avatar.headers['content-type']).toContain('image/png');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: headers() });
    expect(me.json().user.avatarUrl).toBe(uploaded.json().avatarUrl);
  });

  it('manages invitations and switches the active workspace', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: headers() });
    const owner = me.json().user;
    const timestamp = new Date().toISOString();
    const invitation = await app.inject({
      method: 'POST',
      url: '/api/settings/invitations',
      headers: headers(),
      payload: { email: 'teammate@example.com' }
    });
    expect(invitation.statusCode).toBe(201);
    const settings = await app.inject({ method: 'GET', url: '/api/settings', headers: headers() });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().invitations).toHaveLength(1);
    expect(settings.json()).not.toHaveProperty('status');
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/settings/invitations/${invitation.json().id}`,
      headers: headers()
    });
    expect(revoked.statusCode).toBe(204);
    const otherWorkspace = crypto.randomUUID();
    sqlite
      .prepare('INSERT INTO workspaces(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(otherWorkspace, '第二空间', 'team', timestamp, timestamp);
    sqlite
      .prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)')
      .run(otherWorkspace, owner.id, 'member', timestamp);
    const switched = await app.inject({
      method: 'POST',
      url: '/api/settings/workspace/switch',
      headers: headers(),
      payload: { workspaceId: otherWorkspace }
    });
    expect(switched.statusCode).toBe(200);
    const switchedMe = await app.inject({ method: 'GET', url: '/api/me', headers: headers() });
    expect(switchedMe.json().user.workspaceId).toBe(otherWorkspace);
    const switchedBack = await app.inject({
      method: 'POST',
      url: '/api/settings/workspace/switch',
      headers: headers(),
      payload: { workspaceId: owner.workspaceId }
    });
    expect(switchedBack.statusCode).toBe(200);
  });
});

describe('production web assets', () => {
  it('serves the built JavaScript bundle with a JavaScript content type', async () => {
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    const assetPath = index.body.match(/src="([^"]+\.js)"/)?.[1];
    expect(assetPath).toBeTruthy();

    const asset = await app.inject({ method: 'GET', url: assetPath! });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    expect(asset.body).not.toContain('<!doctype html>');
  });
});
