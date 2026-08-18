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

  it('does not expose another author report through workspace search', async () => {
    const owner = sqlite
      .prepare(
        'SELECT workspace_id AS workspaceId,author_id AS authorId FROM weekly_reports ORDER BY created_at LIMIT 1'
      )
      .get() as { workspaceId: string; authorId: string };
    const otherUserId = crypto.randomUUID();
    const otherReportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          'INSERT INTO users(id,display_name,email,timezone,created_at,updated_at) VALUES(?,?,?,?,?,?)'
        )
        .run(
          otherUserId,
          '同空间其他成员',
          'other-author@example.com',
          'Asia/Shanghai',
          timestamp,
          timestamp
        );
      sqlite
        .prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)')
        .run(owner.workspaceId, otherUserId, 'member', timestamp);
      sqlite
        .prepare(
          'INSERT INTO weekly_reports(id,workspace_id,author_id,week_year,week_number,week_start,week_end,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          otherReportId,
          owner.workspaceId,
          otherUserId,
          2026,
          34,
          '2026-08-17',
          '2026-08-23',
          1,
          timestamp,
          timestamp
        );
      sqlite
        .prepare(
          'INSERT INTO report_items(id,report_id,type,content_md,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          crypto.randomUUID(),
          otherReportId,
          'completed',
          '仅属于其他作者的保密检索词',
          'completed',
          '',
          0,
          1,
          timestamp,
          timestamp
        );
    })();

    const search = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('保密检索词')}`,
      headers: headers()
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toEqual([]);
  });

  it('creates a project with report items in one transaction', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/reports/2028/10/projects',
      headers: headers(),
      payload: { name: '事务首条项目', color: '#456990', type: 'completed' }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      project: { name: '事务首条项目', color: '#456990', archivedAt: null },
      items: [{ projectId: created.json().project.id, type: 'completed', contentMd: '', version: 1 }],
      reportVersion: 2
    });

    const report = await app.inject({
      method: 'PUT',
      url: '/api/reports/2028/11',
      headers: headers(),
      payload: {}
    });
    const first = await app.inject({
      method: 'POST',
      url: `/api/reports/${report.json().id}/items`,
      headers: headers(),
      payload: { type: 'next_plan', contentMd: '待归属一' }
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/reports/${report.json().id}/items`,
      headers: headers(),
      payload: { type: 'next_plan', contentMd: '待归属二' }
    });
    const updatedFirst = await app.inject({
      method: 'PATCH',
      url: `/api/report-items/${first.json().id}`,
      headers: headers(),
      payload: { note: '制造版本变化', expectedVersion: 1 }
    });
    const projectName = `事务批量项目-${crypto.randomUUID()}`;
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/reports/2028/11/projects',
      headers: headers(),
      payload: {
        name: projectName,
        color: '#61758A',
        type: 'next_plan',
        assignments: [
          { itemId: first.json().id, expectedVersion: 1 },
          { itemId: second.json().id, expectedVersion: 1 }
        ]
      }
    });
    expect(conflict.statusCode).toBe(409);
    expect(sqlite.prepare('SELECT id FROM projects WHERE name=?').get(projectName)).toBeUndefined();
    expect(
      sqlite
        .prepare('SELECT project_id AS projectId FROM report_items WHERE id IN (?,?)')
        .all(first.json().id, second.json().id)
    ).toEqual([{ projectId: null }, { projectId: null }]);

    const beforeAssignment = await app.inject({
      method: 'GET',
      url: '/api/reports/2028/11',
      headers: headers()
    });
    const assigned = await app.inject({
      method: 'POST',
      url: '/api/reports/2028/11/projects',
      headers: headers(),
      payload: {
        name: projectName,
        color: '#61758A',
        type: 'next_plan',
        assignments: [
          { itemId: first.json().id, expectedVersion: updatedFirst.json().version },
          { itemId: second.json().id, expectedVersion: 1 }
        ]
      }
    });
    expect(assigned.statusCode).toBe(201);
    expect(assigned.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.json().id, projectId: assigned.json().project.id, version: 3 }),
        expect.objectContaining({ id: second.json().id, projectId: assigned.json().project.id, version: 2 })
      ])
    );
    expect(assigned.json().reportVersion).toBe(beforeAssignment.json().version + 1);
  });

  it('manages categories and moves report items transactionally', async () => {
    const development = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: { name: '开发' }
    });
    const operations = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: { name: '运维' }
    });
    expect(development.statusCode).toBe(201);
    expect(operations.statusCode).toBe(201);
    const developmentId = development.json().id;
    const operationsId = operations.json().id;
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: { name: '开发' }
    });
    expect(duplicate.statusCode).toBe(409);

    const firstProject = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(),
      payload: { name: '分类项目甲', color: '#345B9B' }
    });
    const secondProject = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(),
      payload: { name: '分类项目乙', color: '#28624A' }
    });
    const report = await app.inject({
      method: 'PUT',
      url: '/api/reports/2026/34',
      headers: headers(),
      payload: {}
    });
    const reportId = report.json().id;
    const first = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/items`,
      headers: headers(),
      payload: {
        type: 'completed',
        contentMd: '分类条目一',
        projectId: firstProject.json().id,
        categoryId: developmentId
      }
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/items`,
      headers: headers(),
      payload: {
        type: 'completed',
        contentMd: '分类条目二',
        projectId: firstProject.json().id,
        categoryId: developmentId
      }
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ categoryId: developmentId, version: 1 });

    const moved = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: {
        type: 'completed',
        ids: [second.json().id, first.json().id],
        expectedReportVersion: 3,
        move: {
          itemId: first.json().id,
          projectId: secondProject.json().id,
          categoryId: operationsId,
          expectedVersion: 1
        }
      }
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().movedItem).toMatchObject({
      projectId: secondProject.json().id,
      categoryId: operationsId,
      version: 2
    });
    expect(moved.json().reportVersion).toBe(4);
    const incompleteOrder = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: { type: 'completed', ids: [first.json().id], expectedReportVersion: 4 }
    });
    expect(incompleteOrder.statusCode).toBe(400);
    const staleOrder = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: {
        type: 'completed',
        ids: [second.json().id, first.json().id],
        expectedReportVersion: 3
      }
    });
    expect(staleOrder.statusCode).toBe(409);
    expect(staleOrder.json()).toMatchObject({
      error: 'REPORT_VERSION_CONFLICT',
      currentVersion: 4
    });

    const third = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/items`,
      headers: headers(),
      payload: {
        type: 'completed',
        contentMd: '保留停用项目归属',
        projectId: secondProject.json().id,
        categoryId: developmentId
      }
    });
    expect(third.statusCode).toBe(201);

    const archived = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${operationsId}`,
      headers: headers(),
      payload: { archived: true }
    });
    expect(archived.statusCode).toBe(200);
    const archivedProject = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${secondProject.json().id}`,
      headers: headers(),
      payload: { archived: true }
    });
    expect(archivedProject.statusCode).toBe(200);
    const historicalUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/report-items/${first.json().id}`,
      headers: headers(),
      payload: { note: '保留历史分类', categoryId: operationsId, expectedVersion: 2 }
    });
    expect(historicalUpdate.statusCode).toBe(200);
    expect(historicalUpdate.json().categoryId).toBe(operationsId);
    const retainArchivedCategory = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: {
        type: 'completed',
        ids: [second.json().id, first.json().id, third.json().id],
        expectedReportVersion: 6,
        move: {
          itemId: first.json().id,
          projectId: firstProject.json().id,
          categoryId: operationsId,
          expectedVersion: 3
        }
      }
    });
    expect(retainArchivedCategory.statusCode).toBe(200);
    expect(retainArchivedCategory.json()).toMatchObject({
      reportVersion: 7,
      movedItem: { projectId: firstProject.json().id, categoryId: operationsId }
    });
    const retainArchivedProject = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: {
        type: 'completed',
        ids: [second.json().id, first.json().id, third.json().id],
        expectedReportVersion: 7,
        move: {
          itemId: third.json().id,
          projectId: secondProject.json().id,
          categoryId: null,
          expectedVersion: 1
        }
      }
    });
    expect(retainArchivedProject.statusCode).toBe(200);
    expect(retainArchivedProject.json()).toMatchObject({
      reportVersion: 8,
      movedItem: { projectId: secondProject.json().id, categoryId: null }
    });
    const assignArchived = await app.inject({
      method: 'PATCH',
      url: `/api/report-items/${second.json().id}`,
      headers: headers(),
      payload: { categoryId: operationsId, expectedVersion: 1 }
    });
    expect(assignArchived.statusCode).toBe(400);
    const reorderIntoArchivedProject = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: {
        type: 'completed',
        ids: [second.json().id, first.json().id, third.json().id],
        expectedReportVersion: 8,
        move: {
          itemId: second.json().id,
          projectId: secondProject.json().id,
          categoryId: developmentId,
          expectedVersion: 1
        }
      }
    });
    expect(reorderIntoArchivedProject.statusCode).toBe(400);
    expect(reorderIntoArchivedProject.json().error).toBe('INVALID_PROJECT');
    const reorderIntoArchivedCategory = await app.inject({
      method: 'POST',
      url: `/api/reports/${reportId}/reorder`,
      headers: headers(),
      payload: {
        type: 'completed',
        ids: [second.json().id, first.json().id, third.json().id],
        expectedReportVersion: 8,
        move: {
          itemId: second.json().id,
          projectId: firstProject.json().id,
          categoryId: operationsId,
          expectedVersion: 1
        }
      }
    });
    expect(reorderIntoArchivedCategory.statusCode).toBe(400);
    expect(reorderIntoArchivedCategory.json().error).toBe('INVALID_CATEGORY');
    const foreignWorkspaceId = crypto.randomUUID();
    const foreignCategoryId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    sqlite
      .prepare('INSERT INTO workspaces(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(foreignWorkspaceId, '分类隔离空间', 'personal', timestamp, timestamp);
    sqlite
      .prepare(
        'INSERT INTO report_categories(id,workspace_id,name,normalized_name,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
      )
      .run(foreignCategoryId, foreignWorkspaceId, '外部分类', '外部分类', 0, timestamp, timestamp);
    const assignForeign = await app.inject({
      method: 'PATCH',
      url: `/api/report-items/${second.json().id}`,
      headers: headers(),
      payload: { categoryId: foreignCategoryId, expectedVersion: 1 }
    });
    expect(assignForeign.statusCode).toBe(400);

    const batchReport = await app.inject({
      method: 'PUT',
      url: '/api/reports/2026/35',
      headers: headers(),
      payload: {}
    });
    const batchItems = await Promise.all(
      ['批量归类一', '批量归类二', '保留未分类'].map((contentMd) =>
        app.inject({
          method: 'POST',
          url: `/api/reports/${batchReport.json().id}/items`,
          headers: headers(),
          payload: { type: 'completed', contentMd, projectId: firstProject.json().id }
        })
      )
    );
    const clientCategory = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: {
        name: '客户端',
        assignments: batchItems.slice(0, 2).map((item) => ({
          itemId: item.json().id,
          expectedVersion: 1
        }))
      }
    });
    expect(clientCategory.statusCode).toBe(201);
    const clientCategoryId = clientCategory.json().id;
    const batchReportAfter = await app.inject({
      method: 'GET',
      url: '/api/reports/2026/35',
      headers: headers()
    });
    expect(batchReportAfter.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: batchItems[0]!.json().id,
          categoryId: clientCategoryId,
          version: 2
        }),
        expect.objectContaining({
          id: batchItems[1]!.json().id,
          categoryId: clientCategoryId,
          version: 2
        })
      ])
    );
    const rolledBackCategory = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: {
        name: '不会创建',
        assignments: [
          { itemId: batchItems[2]!.json().id, expectedVersion: 1 },
          { itemId: batchItems[0]!.json().id, expectedVersion: 1 }
        ]
      }
    });
    expect(rolledBackCategory.statusCode).toBe(409);
    const batchAfterRollback = await app.inject({
      method: 'GET',
      url: '/api/reports/2026/35',
      headers: headers()
    });
    expect(
      batchAfterRollback.json().items.find((item: { id: string }) => item.id === batchItems[2]!.json().id)
    ).toMatchObject({ categoryId: null, version: 1 });

    const reordered = await app.inject({
      method: 'POST',
      url: '/api/categories/reorder',
      headers: headers(),
      payload: { ids: [operationsId, developmentId, clientCategoryId] }
    });
    expect(reordered.statusCode).toBe(200);
    const categoryList = await app.inject({ method: 'GET', url: '/api/categories', headers: headers() });
    expect(categoryList.json().categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: developmentId, name: '开发' }),
        expect.objectContaining({ id: clientCategoryId, name: '客户端' }),
        expect.objectContaining({ id: operationsId, name: '运维', archivedAt: expect.any(String) })
      ])
    );
    expect(categoryList.json().categories).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '不会创建' })])
    );
    const exported = await app.inject({
      method: 'GET',
      url: '/api/settings/export',
      headers: headers()
    });
    expect(exported.json().categories).toHaveLength(3);
    expect(exported.json().reportItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ categoryId: operationsId })])
    );
  });

  it('creates a category with its first item and imports previous-week work atomically', async () => {
    const sourceProject = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(),
      payload: { name: '引入来源项目', color: '#345B9B' }
    });
    const targetProject = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(),
      payload: { name: '本周新增分类项目', color: '#28624A' }
    });
    const sourceCategory = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: { name: '历史推进分类' }
    });
    const tag = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: headers(),
      payload: { name: '跨周引入', color: '#8A4FA3' }
    });
    const sourceReport = await app.inject({
      method: 'PUT',
      url: '/api/reports/2026/53',
      headers: headers(),
      payload: {}
    });
    expect(sourceReport.statusCode).toBe(200);
    const createSource = (contentMd: string, type: 'completed' | 'next_plan', progress = 'incomplete') =>
      app.inject({
        method: 'POST',
        url: `/api/reports/${sourceReport.json().id}/items`,
        headers: headers(),
        payload: {
          type,
          contentMd,
          projectId: sourceProject.json().id,
          categoryId: sourceCategory.json().id,
          occurredOn: '2026-12-30',
          progress,
          note: `备注：${contentMd}`,
          tagIds: [tag.json().id]
        }
      });
    const first = await createSource('推进任务一', 'completed');
    const second = await createSource('推进任务二', 'next_plan');
    const answered = await createSource('已解答任务', 'completed', 'answered');
    const reserved = await createSource('留待后续引入', 'completed');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${sourceProject.json().id}`,
      headers: headers(),
      payload: { archived: true }
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${sourceCategory.json().id}`,
      headers: headers(),
      payload: { archived: true }
    });

    const targetReport = await app.inject({
      method: 'PUT',
      url: '/api/reports/2027/1',
      headers: headers(),
      payload: {}
    });
    const categoryWithItem = await app.inject({
      method: 'POST',
      url: `/api/reports/${targetReport.json().id}/categories`,
      headers: headers(),
      payload: {
        name: '现场支持分类',
        projectId: targetProject.json().id,
        type: 'completed'
      }
    });
    expect(categoryWithItem.statusCode).toBe(201);
    expect(categoryWithItem.json()).toMatchObject({
      category: { name: '现场支持分类', archivedAt: null },
      item: {
        projectId: targetProject.json().id,
        type: 'completed',
        contentMd: '',
        importedFromItemId: null
      }
    });
    const duplicateCategory = await app.inject({
      method: 'POST',
      url: `/api/reports/${targetReport.json().id}/categories`,
      headers: headers(),
      payload: {
        name: '现场支持分类',
        projectId: targetProject.json().id,
        type: 'completed'
      }
    });
    expect(duplicateCategory.statusCode).toBe(409);
    const beforeImport = await app.inject({
      method: 'GET',
      url: '/api/reports/2027/1',
      headers: headers()
    });
    expect(beforeImport.json().items).toHaveLength(1);
    expect(beforeImport.json().version).toBe(2);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/reports/2027/1/import-items',
      headers: headers(),
      payload: {
        sources: [first, second].map((response) => ({
          itemId: response.json().id,
          expectedVersion: response.json().version
        }))
      }
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().items).toEqual([
      expect.objectContaining({
        importedFromItemId: first.json().id,
        projectId: sourceProject.json().id,
        categoryId: sourceCategory.json().id,
        type: 'completed',
        contentMd: '推进任务一',
        occurredOn: null,
        progress: 'incomplete',
        note: '备注：推进任务一',
        tags: [expect.objectContaining({ id: tag.json().id })]
      }),
      expect.objectContaining({
        importedFromItemId: second.json().id,
        type: 'next_plan',
        contentMd: '推进任务二',
        occurredOn: null,
        progress: 'incomplete'
      })
    ]);
    const afterImport = await app.inject({
      method: 'GET',
      url: '/api/reports/2027/1',
      headers: headers()
    });
    expect(afterImport.json().version).toBe(3);

    const duplicateImport = await app.inject({
      method: 'POST',
      url: '/api/reports/2027/1/import-items',
      headers: headers(),
      payload: {
        sources: [
          { itemId: first.json().id, expectedVersion: 1 },
          { itemId: reserved.json().id, expectedVersion: 1 }
        ]
      }
    });
    expect(duplicateImport.statusCode).toBe(409);
    const afterDuplicate = await app.inject({
      method: 'GET',
      url: '/api/reports/2027/1',
      headers: headers()
    });
    expect(afterDuplicate.json().items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ importedFromItemId: reserved.json().id })])
    );

    const answeredImport = await app.inject({
      method: 'POST',
      url: '/api/reports/2027/1/import-items',
      headers: headers(),
      payload: { sources: [{ itemId: answered.json().id, expectedVersion: 1 }] }
    });
    expect(answeredImport.statusCode).toBe(400);
    const versionConflict = await app.inject({
      method: 'POST',
      url: '/api/reports/2027/1/import-items',
      headers: headers(),
      payload: { sources: [{ itemId: reserved.json().id, expectedVersion: 99 }] }
    });
    expect(versionConflict.statusCode).toBe(409);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: headers() });
    const foreignWorkspaceId = crypto.randomUUID();
    const foreignReportId = crypto.randomUUID();
    const foreignItemId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    sqlite
      .prepare('INSERT INTO workspaces(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(foreignWorkspaceId, '外部引入空间', 'personal', timestamp, timestamp);
    sqlite
      .prepare(
        'INSERT INTO weekly_reports(id,workspace_id,author_id,week_year,week_number,week_start,week_end,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        foreignReportId,
        foreignWorkspaceId,
        me.json().user.id,
        2026,
        53,
        '2026-12-28',
        '2027-01-03',
        1,
        timestamp,
        timestamp
      );
    sqlite
      .prepare(
        'INSERT INTO report_items(id,report_id,type,content_md,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        foreignItemId,
        foreignReportId,
        'completed',
        '外部任务',
        'incomplete',
        '',
        0,
        1,
        timestamp,
        timestamp
      );
    const crossWorkspace = await app.inject({
      method: 'POST',
      url: '/api/reports/2027/1/import-items',
      headers: headers(),
      payload: {
        sources: [
          { itemId: reserved.json().id, expectedVersion: 1 },
          { itemId: foreignItemId, expectedVersion: 1 }
        ]
      }
    });
    expect(crossWorkspace.statusCode).toBe(400);

    const exported = await app.inject({
      method: 'GET',
      url: '/api/settings/export',
      headers: headers()
    });
    expect(exported.json().reportItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ importedFromItemId: first.json().id })])
    );
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
