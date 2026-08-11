import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { memoInputSchema, reportItemInputSchema, reportItemTypes } from '@zhoubao/shared';
import type { ReportItemProgress, ReportItemType } from '@zhoubao/shared';
import { z } from 'zod';
import { id, now, sqlite } from '../db/index.js';
import { requireUser } from '../types.js';
import type { CurrentUser } from '../types.js';
import { isoWeekRange } from '../lib/week.js';
import { config } from '../config.js';

const uuidParam = z.object({ id: z.string().uuid() });
const weekParams = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  week: z.coerce.number().int().min(1).max(53)
});
const expectedVersion = z.object({ expectedVersion: z.number().int().positive() });

interface WeeklyReportRow {
  id: string;
  version: number;
}

interface ReportItemRow {
  id: string;
  reportId?: string;
  report_id?: string;
  projectId?: string | null;
  project_id?: string | null;
  type: ReportItemType;
  contentMd?: string;
  content_md?: string;
  occurredOn?: string | null;
  occurred_on?: string | null;
  progress: ReportItemProgress;
  note?: string;
  position: number;
  version: number;
}

interface SearchResultRow {
  id: string;
  contentMd: string;
  type: ReportItemType;
  projectId: string | null;
  weekYear: number;
  weekNumber: number;
  weekStart: string;
  projectName: string | null;
  projectColor: string | null;
}

interface MemoRow {
  id: string;
  title: string;
  contentMd?: string;
  content_md?: string;
  projectId?: string | null;
  project_id?: string | null;
  color: string;
  pinned: number;
  archivedAt?: string | null;
  archived_at?: string | null;
  convertedReportItemId?: string | null;
  converted_report_item_id?: string | null;
  version: number;
}

function detectImage(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return { mimeType: 'image/png', extension: 'png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')))
    return { mimeType: 'image/gif', extension: 'gif' };
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}

function replaceTags(
  table: 'report_item_tags' | 'memo_card_tags',
  column: 'report_item_id' | 'memo_card_id',
  entityId: string,
  tagIds: string[],
  workspaceId: string
) {
  sqlite.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(entityId);
  const insert = sqlite.prepare(
    `INSERT INTO ${table}(${column},tag_id) SELECT ?,id FROM tags WHERE id=? AND workspace_id=?`
  );
  tagIds.forEach((tagId) => insert.run(entityId, tagId, workspaceId));
}

function loadTagsFor(itemId: string, table = 'report_item_tags', column = 'report_item_id') {
  return sqlite
    .prepare(
      `SELECT t.id,t.name,t.color FROM tags t JOIN ${table} x ON x.tag_id=t.id WHERE x.${column}=? ORDER BY t.name COLLATE NOCASE`
    )
    .all(itemId);
}

function serializeReportItem(row: ReportItemRow) {
  return {
    id: row.id,
    reportId: row.reportId ?? row.report_id,
    projectId: row.projectId ?? row.project_id ?? null,
    type: row.type,
    contentMd: row.contentMd ?? row.content_md,
    occurredOn: row.occurredOn ?? row.occurred_on ?? null,
    progress: row.progress,
    note: row.note ?? '',
    position: row.position,
    version: row.version,
    tags: loadTagsFor(row.id)
  };
}

function ensureReport(workspaceId: string, authorId: string, weekYear: number, weekNumber: number) {
  const range = isoWeekRange(weekYear, weekNumber);
  let report = sqlite
    .prepare(
      'SELECT * FROM weekly_reports WHERE workspace_id=? AND author_id=? AND week_year=? AND week_number=?'
    )
    .get(workspaceId, authorId, weekYear, weekNumber) as WeeklyReportRow | undefined;
  if (!report) {
    const timestamp = now();
    const reportId = id();
    sqlite
      .prepare(
        `INSERT INTO weekly_reports(id,workspace_id,author_id,week_year,week_number,week_start,week_end,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        reportId,
        workspaceId,
        authorId,
        weekYear,
        weekNumber,
        range.weekStart,
        range.weekEnd,
        1,
        timestamp,
        timestamp
      );
    report = sqlite.prepare('SELECT id,version FROM weekly_reports WHERE id=?').get(reportId) as
      WeeklyReportRow | undefined;
  }
  if (!report) throw new Error('创建周报失败');
  return report;
}

function serializeReport(user: CurrentUser, weekYear: number, weekNumber: number) {
  const range = isoWeekRange(weekYear, weekNumber);
  const report = sqlite
    .prepare(
      'SELECT * FROM weekly_reports WHERE workspace_id=? AND author_id=? AND week_year=? AND week_number=?'
    )
    .get(user.workspaceId, user.id, weekYear, weekNumber) as WeeklyReportRow | undefined;
  const items = report
    ? (
        sqlite
          .prepare(
            `SELECT id,report_id AS reportId,project_id AS projectId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version FROM report_items WHERE report_id=? ORDER BY type,position,created_at`
          )
          .all(report.id) as ReportItemRow[]
      ).map(serializeReportItem)
    : [];
  const calendarDays = sqlite
    .prepare('SELECT date,kind,name FROM calendar_days WHERE date BETWEEN ? AND ? ORDER BY date')
    .all(range.weekStart, range.weekEnd);
  const available = Boolean(
    sqlite.prepare('SELECT 1 FROM calendar_days WHERE source_year=? LIMIT 1').get(weekYear)
  );
  return {
    id: report?.id ?? null,
    weekYear,
    weekNumber,
    ...range,
    version: report?.version ?? 0,
    author: { id: user.id, displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl },
    items,
    calendarDays,
    holidayDataAvailable: available
  };
}

export async function registerApi(app: FastifyInstance) {
  app.get('/api/me', { preHandler: requireUser }, async (request) => ({ user: request.currentUser }));

  app.get('/api/report-weeks/:year', { preHandler: requireUser }, async (request) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2200) }).parse(request.params);
    const weeks = sqlite
      .prepare(
        `
      SELECT wr.week_number AS weekNumber,COUNT(ri.id) AS itemCount
      FROM weekly_reports wr
      JOIN report_items ri ON ri.report_id=wr.id AND TRIM(ri.content_md)<>''
      WHERE wr.workspace_id=? AND wr.author_id=? AND wr.week_year=?
      GROUP BY wr.week_number
      ORDER BY wr.week_number
    `
      )
      .all(request.currentUser!.workspaceId, request.currentUser!.id, year);
    return { year, weeks };
  });
  app.get('/api/reports/:year/:week', { preHandler: requireUser }, async (request) => {
    const p = weekParams.parse(request.params);
    return serializeReport(request.currentUser!, p.year, p.week);
  });
  app.put('/api/reports/:year/:week', { preHandler: requireUser }, async (request) => {
    const p = weekParams.parse(request.params);
    ensureReport(request.currentUser!.workspaceId, request.currentUser!.id, p.year, p.week);
    return serializeReport(request.currentUser!, p.year, p.week);
  });
  app.post('/api/reports/:id/items', { preHandler: requireUser }, async (request, reply) => {
    const { id: reportId } = uuidParam.parse(request.params);
    const input = reportItemInputSchema.parse(request.body);
    const user = request.currentUser!;
    const report = sqlite
      .prepare('SELECT id FROM weekly_reports WHERE id=? AND workspace_id=? AND author_id=?')
      .get(reportId, user.workspaceId, user.id);
    if (!report) return reply.code(404).send({ error: 'NOT_FOUND' });
    const pos =
      input.position ??
      (
        sqlite
          .prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM report_items WHERE report_id=? AND type=?')
          .get(reportId, input.type) as { p: number }
      ).p;
    const progress = input.progress ?? (input.type === 'completed' ? 'completed' : 'incomplete');
    const itemId = id();
    const timestamp = now();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          'INSERT INTO report_items(id,report_id,project_id,type,content_md,occurred_on,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          itemId,
          reportId,
          input.projectId ?? null,
          input.type,
          input.contentMd,
          input.occurredOn ?? null,
          progress,
          input.note ?? '',
          pos,
          1,
          timestamp,
          timestamp
        );
      replaceTags('report_item_tags', 'report_item_id', itemId, input.tagIds, user.workspaceId);
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(timestamp, reportId);
    })();
    return reply.code(201).send({
      id: itemId,
      reportId,
      projectId: input.projectId ?? null,
      type: input.type,
      contentMd: input.contentMd,
      occurredOn: input.occurredOn ?? null,
      progress,
      note: input.note ?? '',
      position: pos,
      version: 1,
      tags: loadTagsFor(itemId)
    });
  });
  app.patch('/api/report-items/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: itemId } = uuidParam.parse(request.params);
    const body = reportItemInputSchema.partial().merge(expectedVersion).parse(request.body);
    const user = request.currentUser!;
    const current = sqlite
      .prepare(
        `SELECT ri.*,wr.workspace_id,wr.author_id FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE ri.id=? AND wr.workspace_id=? AND wr.author_id=?`
      )
      .get(itemId, user.workspaceId, user.id) as ReportItemRow | undefined;
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (current.version !== body.expectedVersion)
      return reply.code(409).send({ error: 'VERSION_CONFLICT', current: serializeReportItem(current) });
    const timestamp = now();
    sqlite.transaction(() => {
      const result = sqlite
        .prepare(
          'UPDATE report_items SET project_id=?,type=?,content_md=?,occurred_on=?,progress=?,note=?,position=?,version=version+1,updated_at=? WHERE id=? AND version=?'
        )
        .run(
          body.projectId === undefined ? current.project_id : body.projectId,
          body.type ?? current.type,
          body.contentMd ?? current.content_md,
          body.occurredOn === undefined ? current.occurred_on : body.occurredOn,
          body.progress ?? current.progress,
          body.note ?? current.note,
          body.position ?? current.position,
          timestamp,
          itemId,
          body.expectedVersion
        );
      if (!result.changes) throw new Error('VERSION_CONFLICT');
      if (body.tagIds)
        replaceTags('report_item_tags', 'report_item_id', itemId, body.tagIds, user.workspaceId);
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(timestamp, current.report_id);
    })();
    const row = sqlite
      .prepare(
        'SELECT id,report_id AS reportId,project_id AS projectId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version FROM report_items WHERE id=?'
      )
      .get(itemId) as ReportItemRow;
    return serializeReportItem(row);
  });
  app.post('/api/report-items/:id/images', { preHandler: requireUser }, async (request, reply) => {
    const { id: itemId } = uuidParam.parse(request.params);
    const user = request.currentUser!;
    const item = sqlite
      .prepare(
        'SELECT ri.id FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE ri.id=? AND wr.workspace_id=? AND wr.author_id=?'
      )
      .get(itemId, user.workspaceId, user.id);
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND' });
    let upload;
    try {
      upload = await request.file();
    } catch {
      return reply.code(413).send({ error: 'IMAGE_TOO_LARGE', message: '图片不能超过 8 MB' });
    }
    if (!upload) return reply.code(400).send({ error: 'IMAGE_REQUIRED', message: '请选择图片' });
    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return reply.code(413).send({ error: 'IMAGE_TOO_LARGE', message: '图片不能超过 8 MB' });
    }
    const image = detectImage(buffer);
    if (!image)
      return reply
        .code(415)
        .send({ error: 'UNSUPPORTED_IMAGE', message: '仅支持 PNG、JPEG、GIF 或 WebP 图片' });
    const attachmentId = id();
    const storedName = `${attachmentId}.${image.extension}`;
    const workspaceDirectory = path.join(config.uploadDir, user.workspaceId);
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    fs.writeFileSync(path.join(workspaceDirectory, storedName), buffer, { flag: 'wx' });
    const originalName = path.basename(upload.filename || 'image').slice(0, 255) || 'image';
    sqlite
      .prepare(
        'INSERT INTO report_attachments(id,workspace_id,author_id,report_item_id,original_name,stored_name,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
      )
      .run(
        attachmentId,
        user.workspaceId,
        user.id,
        itemId,
        originalName,
        `${user.workspaceId}/${storedName}`,
        image.mimeType,
        buffer.length,
        now()
      );
    return reply.code(201).send({ id: attachmentId, originalName, url: `/api/attachments/${attachmentId}` });
  });
  app.get('/api/attachments/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: attachmentId } = uuidParam.parse(request.params);
    const user = request.currentUser!;
    const attachment = sqlite
      .prepare(
        'SELECT stored_name AS storedName,mime_type AS mimeType,size_bytes AS sizeBytes FROM report_attachments WHERE id=? AND workspace_id=? AND author_id=?'
      )
      .get(attachmentId, user.workspaceId, user.id) as
      { storedName: string; mimeType: string; sizeBytes: number } | undefined;
    if (!attachment) return reply.code(404).send({ error: 'NOT_FOUND' });
    const filePath = path.join(config.uploadDir, attachment.storedName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'FILE_NOT_FOUND' });
    return reply
      .type(attachment.mimeType)
      .header('Content-Length', String(attachment.sizeBytes))
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(fs.createReadStream(filePath));
  });
  app.get('/api/report-items/:id/attachments', { preHandler: requireUser }, async (request, reply) => {
    const { id: itemId } = uuidParam.parse(request.params);
    const user = request.currentUser!;
    const item = sqlite
      .prepare(
        'SELECT ri.id FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE ri.id=? AND wr.workspace_id=? AND wr.author_id=?'
      )
      .get(itemId, user.workspaceId, user.id);
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND' });
    return {
      attachments: sqlite
        .prepare(
          'SELECT id,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,created_at AS createdAt FROM report_attachments WHERE report_item_id=? ORDER BY created_at'
        )
        .all(itemId)
    };
  });
  app.delete('/api/attachments/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: attachmentId } = uuidParam.parse(request.params);
    const user = request.currentUser!;
    const attachment = sqlite
      .prepare(
        'SELECT id,stored_name AS storedName FROM report_attachments WHERE id=? AND workspace_id=? AND author_id=?'
      )
      .get(attachmentId, user.workspaceId, user.id) as { id: string; storedName: string } | undefined;
    if (!attachment) return reply.code(404).send({ error: 'NOT_FOUND' });
    sqlite.prepare('DELETE FROM report_attachments WHERE id=?').run(attachmentId);
    fs.rmSync(path.join(config.uploadDir, attachment.storedName), { force: true });
    return reply.code(204).send();
  });
  app.delete('/api/report-items/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: itemId } = uuidParam.parse(request.params);
    const row = sqlite
      .prepare(
        'SELECT ri.report_id FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE ri.id=? AND wr.workspace_id=? AND wr.author_id=?'
      )
      .get(itemId, request.currentUser!.workspaceId, request.currentUser!.id) as
      { report_id: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    const attachments = sqlite
      .prepare('SELECT stored_name AS storedName FROM report_attachments WHERE report_item_id=?')
      .all(itemId) as Array<{ storedName: string }>;
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM report_items WHERE id=?').run(itemId);
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(now(), row.report_id);
    })();
    attachments.forEach((attachment) =>
      fs.rmSync(path.join(config.uploadDir, attachment.storedName), { force: true })
    );
    return reply.code(204).send();
  });
  app.post('/api/reports/:id/reorder', { preHandler: requireUser }, async (request, reply) => {
    const { id: reportId } = uuidParam.parse(request.params);
    const body = z
      .object({ type: z.enum(reportItemTypes), ids: z.array(z.string().uuid()) })
      .parse(request.body);
    const report = sqlite
      .prepare('SELECT 1 FROM weekly_reports WHERE id=? AND workspace_id=? AND author_id=?')
      .get(reportId, request.currentUser!.workspaceId, request.currentUser!.id);
    if (!report) return reply.code(404).send({ error: 'NOT_FOUND' });
    sqlite.transaction(() =>
      body.ids.forEach((itemId, index) =>
        sqlite
          .prepare('UPDATE report_items SET position=?,updated_at=? WHERE id=? AND report_id=? AND type=?')
          .run(index, now(), itemId, reportId, body.type)
      )
    )();
    return { ok: true };
  });

  app.get('/api/search', { preHandler: requireUser }, async (request) => {
    const q = z
      .object({
        q: z.string().max(200).default(''),
        from: z.string().optional(),
        to: z.string().optional(),
        projectId: z.string().uuid().optional(),
        type: z.enum(reportItemTypes).optional(),
        tagIds: z.string().optional(),
        tagMode: z.enum(['all', 'any']).default('all'),
        page: z.coerce.number().int().min(1).default(1)
      })
      .parse(request.query);
    const tags = (q.tagIds ?? '').split(',').filter(Boolean);
    const where = ['wr.workspace_id=?'];
    const args: Array<string | number> = [request.currentUser!.workspaceId];
    if (q.q) {
      where.push("ri.content_md LIKE ? ESCAPE '\\'");
      args.push(`%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (q.from) {
      where.push('wr.week_start>=?');
      args.push(q.from);
    }
    if (q.to) {
      where.push('wr.week_end<=?');
      args.push(q.to);
    }
    if (q.projectId) {
      where.push('ri.project_id=?');
      args.push(q.projectId);
    }
    if (q.type) {
      where.push('ri.type=?');
      args.push(q.type);
    }
    if (tags.length) {
      const marks = tags.map(() => '?').join(',');
      where.push(
        `ri.id IN (SELECT report_item_id FROM report_item_tags WHERE tag_id IN (${marks}) GROUP BY report_item_id HAVING COUNT(DISTINCT tag_id) ${q.tagMode === 'all' ? '=' : '>='} ?)`
      );
      args.push(...tags, q.tagMode === 'all' ? tags.length : 1);
    }
    const rows = sqlite
      .prepare(
        `SELECT ri.id,ri.content_md AS contentMd,ri.type,ri.project_id AS projectId,wr.week_year AS weekYear,wr.week_number AS weekNumber,wr.week_start AS weekStart,p.name AS projectName,p.color AS projectColor FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id LEFT JOIN projects p ON p.id=ri.project_id WHERE ${where.join(' AND ')} ORDER BY wr.week_start DESC,ri.position LIMIT 21 OFFSET ?`
      )
      .all(...args, (q.page - 1) * 20) as SearchResultRow[];
    return {
      items: rows.slice(0, 20).map((row) => ({ ...row, tags: loadTagsFor(row.id) })),
      page: q.page,
      hasMore: rows.length > 20
    };
  });

  app.get('/api/memos', { preHandler: requireUser }, async (request) => {
    const query = z.object({ archived: z.enum(['true', 'false']).default('false') }).parse(request.query);
    const rows = sqlite
      .prepare(
        `SELECT id,title,content_md AS contentMd,project_id AS projectId,color,pinned,archived_at AS archivedAt,converted_report_item_id AS convertedReportItemId,version,created_at AS createdAt,updated_at AS updatedAt FROM memo_cards WHERE workspace_id=? AND author_id=? AND archived_at IS ${query.archived === 'true' ? 'NOT NULL' : 'NULL'} ORDER BY pinned DESC,updated_at DESC`
      )
      .all(request.currentUser!.workspaceId, request.currentUser!.id) as MemoRow[];
    return {
      memos: rows.map((row) => ({
        ...row,
        pinned: Boolean(row.pinned),
        tags: loadTagsFor(row.id, 'memo_card_tags', 'memo_card_id')
      }))
    };
  });
  app.post('/api/memos', { preHandler: requireUser }, async (request, reply) => {
    const input = memoInputSchema.parse(request.body);
    const memoId = id();
    const timestamp = now();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          'INSERT INTO memo_cards(id,workspace_id,author_id,project_id,title,content_md,color,pinned,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          memoId,
          request.currentUser!.workspaceId,
          request.currentUser!.id,
          input.projectId ?? null,
          input.title,
          input.contentMd,
          input.color,
          input.pinned ? 1 : 0,
          1,
          timestamp,
          timestamp
        );
      replaceTags('memo_card_tags', 'memo_card_id', memoId, input.tagIds, request.currentUser!.workspaceId);
    })();
    return reply.code(201).send({
      id: memoId,
      ...input,
      convertedReportItemId: null,
      version: 1,
      tags: loadTagsFor(memoId, 'memo_card_tags', 'memo_card_id')
    });
  });
  app.patch('/api/memos/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: memoId } = uuidParam.parse(request.params);
    const body = memoInputSchema
      .partial()
      .merge(expectedVersion)
      .extend({ archived: z.boolean().optional() })
      .parse(request.body);
    const current = sqlite
      .prepare('SELECT * FROM memo_cards WHERE id=? AND workspace_id=? AND author_id=?')
      .get(memoId, request.currentUser!.workspaceId, request.currentUser!.id) as MemoRow | undefined;
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (current.version !== body.expectedVersion) return reply.code(409).send({ error: 'VERSION_CONFLICT' });
    sqlite.transaction(() => {
      sqlite
        .prepare(
          'UPDATE memo_cards SET project_id=?,title=?,content_md=?,color=?,pinned=?,archived_at=?,version=version+1,updated_at=? WHERE id=?'
        )
        .run(
          body.projectId === undefined ? current.project_id : body.projectId,
          body.title ?? current.title,
          body.contentMd ?? current.content_md,
          body.color ?? current.color,
          body.pinned === undefined ? current.pinned : body.pinned ? 1 : 0,
          body.archived === undefined ? current.archived_at : body.archived ? now() : null,
          now(),
          memoId
        );
      if (body.tagIds)
        replaceTags('memo_card_tags', 'memo_card_id', memoId, body.tagIds, request.currentUser!.workspaceId);
    })();
    return { ok: true };
  });
  app.delete('/api/memos/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: memoId } = uuidParam.parse(request.params);
    sqlite
      .prepare('DELETE FROM memo_cards WHERE id=? AND workspace_id=? AND author_id=?')
      .run(memoId, request.currentUser!.workspaceId, request.currentUser!.id);
    return reply.code(204).send();
  });
  app.post('/api/memos/:id/convert', { preHandler: requireUser }, async (request, reply) => {
    const { id: memoId } = uuidParam.parse(request.params);
    const body = z
      .object({
        weekYear: z.number().int(),
        weekNumber: z.number().int().min(1).max(53),
        type: z.enum(reportItemTypes),
        projectId: z.string().uuid().nullable().optional()
      })
      .parse(request.body);
    const memo = sqlite
      .prepare('SELECT * FROM memo_cards WHERE id=? AND workspace_id=? AND author_id=?')
      .get(memoId, request.currentUser!.workspaceId, request.currentUser!.id) as MemoRow | undefined;
    if (!memo) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (memo.converted_report_item_id)
      return reply
        .code(409)
        .send({ error: 'ALREADY_CONVERTED', reportItemId: memo.converted_report_item_id });
    const report = ensureReport(
      request.currentUser!.workspaceId,
      request.currentUser!.id,
      body.weekYear,
      body.weekNumber
    );
    const itemId = id();
    const timestamp = now();
    sqlite.transaction(() => {
      const pos = (
        sqlite
          .prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM report_items WHERE report_id=? AND type=?')
          .get(report.id, body.type) as { p: number }
      ).p;
      const progress = body.type === 'completed' ? 'completed' : 'incomplete';
      sqlite
        .prepare(
          'INSERT INTO report_items(id,report_id,project_id,type,content_md,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          itemId,
          report.id,
          body.projectId ?? memo.project_id,
          body.type,
          `## ${memo.title}\n\n${memo.content_md}`,
          progress,
          '',
          pos,
          1,
          timestamp,
          timestamp
        );
      const memoTags = sqlite
        .prepare('SELECT tag_id FROM memo_card_tags WHERE memo_card_id=?')
        .all(memoId) as Array<{ tag_id: string }>;
      replaceTags(
        'report_item_tags',
        'report_item_id',
        itemId,
        memoTags.map((t) => t.tag_id),
        request.currentUser!.workspaceId
      );
      sqlite
        .prepare('UPDATE memo_cards SET converted_report_item_id=?,version=version+1,updated_at=? WHERE id=?')
        .run(itemId, timestamp, memoId);
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(timestamp, report.id);
    })();
    return reply
      .code(201)
      .send({ reportItemId: itemId, weekYear: body.weekYear, weekNumber: body.weekNumber });
  });

  app.get('/api/calendar', { preHandler: requireUser }, async (request) => {
    const q = z.object({ from: z.iso.date(), to: z.iso.date() }).parse(request.query);
    return {
      days: sqlite
        .prepare(
          'SELECT date,kind,name,source_year AS sourceYear,note FROM calendar_days WHERE date BETWEEN ? AND ? ORDER BY date'
        )
        .all(q.from, q.to)
    };
  });
}
