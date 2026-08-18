import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  projectInputSchema,
  reportCategoryInputSchema,
  reportItemInputSchema,
  reportItemTypes
} from '@zhoubao/shared';
import type { ReportItemProgress, ReportItemType } from '@zhoubao/shared';
import { z } from 'zod';
import { id, now, sqlite } from '../db/index.js';
import { requireUser } from '../types.js';
import type { CurrentUser } from '../types.js';
import { isoWeekForDate, isoWeekRange } from '../lib/week.js';
import { detectImage } from '../lib/image.js';
import { config } from '../config.js';

const uuidParam = z.object({ id: z.string().uuid() });
const weekParams = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  week: z.coerce.number().int().min(1).max(53)
});
const expectedVersion = z.object({ expectedVersion: z.number().int().positive() });
const categoryWithItemInput = reportCategoryInputSchema.extend({
  projectId: z.string().uuid().nullable(),
  type: z.enum(reportItemTypes)
});
const projectWithItemsInput = projectInputSchema.extend({
  type: z.enum(reportItemTypes),
  assignments: z
    .array(z.object({ itemId: z.string().uuid(), expectedVersion: z.number().int().positive() }))
    .max(500)
    .optional()
});
const importPreviousItemsInput = z.object({
  sources: z
    .array(z.object({ itemId: z.string().uuid(), expectedVersion: z.number().int().positive() }))
    .min(1)
    .max(200)
});

interface WeeklyReportRow {
  id: string;
  version: number;
}

interface ReportItemRow {
  id: string;
  reportId?: string;
  report_id?: string;
  importedFromItemId?: string | null;
  imported_from_item_id?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  categoryId?: string | null;
  category_id?: string | null;
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

function replaceTags(entityId: string, tagIds: string[], workspaceId: string) {
  sqlite.prepare('DELETE FROM report_item_tags WHERE report_item_id=?').run(entityId);
  const insert = sqlite.prepare(
    'INSERT INTO report_item_tags(report_item_id,tag_id) SELECT ?,id FROM tags WHERE id=? AND workspace_id=?'
  );
  tagIds.forEach((tagId) => insert.run(entityId, tagId, workspaceId));
}

function loadTagsFor(itemId: string) {
  return sqlite
    .prepare(
      'SELECT t.id,t.name,t.color FROM tags t JOIN report_item_tags x ON x.tag_id=t.id WHERE x.report_item_id=? ORDER BY t.name COLLATE NOCASE'
    )
    .all(itemId);
}

function serializeReportItem(row: ReportItemRow) {
  return {
    id: row.id,
    reportId: row.reportId ?? row.report_id,
    importedFromItemId: row.importedFromItemId ?? row.imported_from_item_id ?? null,
    projectId: row.projectId ?? row.project_id ?? null,
    categoryId: row.categoryId ?? row.category_id ?? null,
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

const normalizeCategoryName = (name: string) => name.normalize('NFKC').toLocaleLowerCase('zh-CN');

function previousIsoWeek(weekYear: number, weekNumber: number) {
  const { weekStart } = isoWeekRange(weekYear, weekNumber);
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return isoWeekForDate(date.toISOString().slice(0, 10));
}

function validProjectId(projectId: string | null, workspaceId: string) {
  if (projectId === null) return true;
  return Boolean(
    sqlite
      .prepare('SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL')
      .get(projectId, workspaceId)
  );
}

function validCategoryId(categoryId: string | null, workspaceId: string) {
  if (categoryId === null) return true;
  return Boolean(
    sqlite
      .prepare('SELECT 1 FROM report_categories WHERE id=? AND workspace_id=? AND archived_at IS NULL')
      .get(categoryId, workspaceId)
  );
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
            `SELECT id,report_id AS reportId,imported_from_item_id AS importedFromItemId,project_id AS projectId,category_id AS categoryId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version FROM report_items WHERE report_id=? ORDER BY type,position,created_at`
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
  app.post('/api/reports/:year/:week/projects', { preHandler: requireUser }, async (request, reply) => {
    const target = weekParams.parse(request.params);
    const input = projectWithItemsInput.parse(request.body);
    const assignments = input.assignments ?? [];
    const assignmentIds = assignments.map((assignment) => assignment.itemId);
    if (new Set(assignmentIds).size !== assignmentIds.length)
      return reply.code(400).send({ error: 'DUPLICATE_PROJECT_ASSIGNMENT' });
    const user = request.currentUser!;
    const projectId = id();
    const createdItemIds: string[] = [];
    const timestamp = now();
    let projectPosition = 0;
    let reportVersion = 0;
    try {
      sqlite.transaction(() => {
        const report = ensureReport(user.workspaceId, user.id, target.year, target.week);
        if (assignments.length) {
          const placeholders = assignments.map(() => '?').join(',');
          const assignmentRows = sqlite
            .prepare(`SELECT * FROM report_items WHERE report_id=? AND id IN (${placeholders}) AND type=?`)
            .all(report.id, ...assignmentIds, input.type) as ReportItemRow[];
          if (assignmentRows.length !== assignments.length) throw new Error('INVALID_PROJECT_ASSIGNMENT');
          const assignmentById = new Map(assignments.map((assignment) => [assignment.itemId, assignment]));
          const conflict = assignmentRows.find(
            (row) => row.project_id !== null || row.version !== assignmentById.get(row.id)?.expectedVersion
          );
          if (conflict) throw new Error(`PROJECT_ASSIGNMENT_CONFLICT:${conflict.id}`);
        }
        projectPosition = (
          sqlite
            .prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM projects WHERE workspace_id=?')
            .get(user.workspaceId) as { position: number }
        ).position;
        sqlite
          .prepare(
            'INSERT INTO projects(id,workspace_id,name,color,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
          )
          .run(projectId, user.workspaceId, input.name, input.color, projectPosition, timestamp, timestamp);
        if (assignments.length) {
          const updateItem = sqlite.prepare(
            'UPDATE report_items SET project_id=?,version=version+1,updated_at=? WHERE id=? AND report_id=? AND project_id IS NULL AND version=?'
          );
          assignments.forEach((assignment) => {
            const result = updateItem.run(
              projectId,
              timestamp,
              assignment.itemId,
              report.id,
              assignment.expectedVersion
            );
            if (!result.changes) throw new Error(`PROJECT_ASSIGNMENT_CONFLICT:${assignment.itemId}`);
            createdItemIds.push(assignment.itemId);
          });
        } else {
          const itemId = id();
          const position = (
            sqlite
              .prepare(
                'SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_items WHERE report_id=? AND type=?'
              )
              .get(report.id, input.type) as { position: number }
          ).position;
          sqlite
            .prepare(
              'INSERT INTO report_items(id,report_id,project_id,type,content_md,occurred_on,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
            )
            .run(
              itemId,
              report.id,
              projectId,
              input.type,
              '',
              null,
              input.type === 'completed' ? 'completed' : 'incomplete',
              '',
              position,
              1,
              timestamp,
              timestamp
            );
          createdItemIds.push(itemId);
        }
        sqlite
          .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
          .run(timestamp, report.id);
        reportVersion = (
          sqlite.prepare('SELECT version FROM weekly_reports WHERE id=?').get(report.id) as {
            version: number;
          }
        ).version;
      })();
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_PROJECT_ASSIGNMENT')
        return reply.code(400).send({ error: 'INVALID_PROJECT_ASSIGNMENT' });
      if (error instanceof Error && error.message.startsWith('PROJECT_ASSIGNMENT_CONFLICT:'))
        return reply.code(409).send({
          error: 'PROJECT_ASSIGNMENT_CONFLICT',
          itemId: error.message.slice('PROJECT_ASSIGNMENT_CONFLICT:'.length)
        });
      throw error;
    }
    const items = createdItemIds.map((itemId) => {
      const row = sqlite.prepare('SELECT * FROM report_items WHERE id=?').get(itemId) as ReportItemRow;
      return serializeReportItem(row);
    });
    return reply.code(201).send({
      project: {
        id: projectId,
        name: input.name,
        color: input.color,
        position: projectPosition,
        archivedAt: null
      },
      items,
      reportVersion
    });
  });
  app.post('/api/reports/:id/categories', { preHandler: requireUser }, async (request, reply) => {
    const { id: reportId } = uuidParam.parse(request.params);
    const input = categoryWithItemInput.parse(request.body);
    const user = request.currentUser!;
    const report = sqlite
      .prepare('SELECT id FROM weekly_reports WHERE id=? AND workspace_id=? AND author_id=?')
      .get(reportId, user.workspaceId, user.id);
    if (!report) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!validProjectId(input.projectId, user.workspaceId))
      return reply.code(400).send({ error: 'INVALID_PROJECT', message: '项目不可用' });
    const categoryId = id();
    const itemId = id();
    const timestamp = now();
    const categoryPosition = (
      sqlite
        .prepare(
          'SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_categories WHERE workspace_id=?'
        )
        .get(user.workspaceId) as { position: number }
    ).position;
    const itemPosition = (
      sqlite
        .prepare(
          'SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_items WHERE report_id=? AND type=?'
        )
        .get(reportId, input.type) as { position: number }
    ).position;
    const progress: ReportItemProgress = input.type === 'completed' ? 'completed' : 'incomplete';
    try {
      sqlite.transaction(() => {
        sqlite
          .prepare(
            'INSERT INTO report_categories(id,workspace_id,name,normalized_name,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
          )
          .run(
            categoryId,
            user.workspaceId,
            input.name,
            normalizeCategoryName(input.name),
            categoryPosition,
            timestamp,
            timestamp
          );
        sqlite
          .prepare(
            'INSERT INTO report_items(id,report_id,project_id,category_id,type,content_md,occurred_on,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
          )
          .run(
            itemId,
            reportId,
            input.projectId,
            categoryId,
            input.type,
            '',
            null,
            progress,
            '',
            itemPosition,
            1,
            timestamp,
            timestamp
          );
        sqlite
          .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
          .run(timestamp, reportId);
      })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE'))
        return reply.code(409).send({ error: 'CATEGORY_EXISTS', message: '分类已存在' });
      throw error;
    }
    return reply.code(201).send({
      category: { id: categoryId, name: input.name, position: categoryPosition, archivedAt: null },
      item: {
        id: itemId,
        reportId,
        importedFromItemId: null,
        projectId: input.projectId,
        categoryId,
        type: input.type,
        contentMd: '',
        occurredOn: null,
        progress,
        note: '',
        position: itemPosition,
        version: 1,
        tags: []
      }
    });
  });
  app.post('/api/reports/:year/:week/import-items', { preHandler: requireUser }, async (request, reply) => {
    const target = weekParams.parse(request.params);
    const body = importPreviousItemsInput.parse(request.body);
    const user = request.currentUser!;
    const sourceIds = body.sources.map((source) => source.itemId);
    if (new Set(sourceIds).size !== sourceIds.length)
      return reply.code(400).send({ error: 'DUPLICATE_IMPORT_SOURCE' });
    const sourceWeek = previousIsoWeek(target.year, target.week);
    const sourceReport = sqlite
      .prepare(
        'SELECT id FROM weekly_reports WHERE workspace_id=? AND author_id=? AND week_year=? AND week_number=?'
      )
      .get(user.workspaceId, user.id, sourceWeek.weekYear, sourceWeek.weekNumber) as
      { id: string } | undefined;
    if (!sourceReport) return reply.code(400).send({ error: 'INVALID_IMPORT_SOURCE' });
    const placeholders = sourceIds.map(() => '?').join(',');
    const rows = sqlite
      .prepare(
        `SELECT id,report_id AS reportId,imported_from_item_id AS importedFromItemId,project_id AS projectId,category_id AS categoryId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version
         FROM report_items WHERE report_id=? AND id IN (${placeholders})`
      )
      .all(sourceReport.id, ...sourceIds) as ReportItemRow[];
    if (rows.length !== body.sources.length) return reply.code(400).send({ error: 'INVALID_IMPORT_SOURCE' });
    const requestById = new Map(body.sources.map((source) => [source.itemId, source]));
    const versionConflict = rows.find((row) => row.version !== requestById.get(row.id)?.expectedVersion);
    if (versionConflict)
      return reply.code(409).send({ error: 'IMPORT_SOURCE_CONFLICT', itemId: versionConflict.id });
    if (rows.some((row) => row.progress !== 'incomplete' || !(row.contentMd ?? row.content_md ?? '').trim()))
      return reply.code(400).send({ error: 'INVALID_IMPORT_SOURCE' });
    const sourceById = new Map(rows.map((row) => [row.id, row]));
    const orderedSources = sourceIds.map((sourceId) => sourceById.get(sourceId)!);
    const existingTarget = sqlite
      .prepare(
        'SELECT id FROM weekly_reports WHERE workspace_id=? AND author_id=? AND week_year=? AND week_number=?'
      )
      .get(user.workspaceId, user.id, target.year, target.week) as { id: string } | undefined;
    if (existingTarget) {
      const duplicate = sqlite
        .prepare(
          `SELECT imported_from_item_id AS sourceId FROM report_items WHERE report_id=? AND imported_from_item_id IN (${placeholders}) LIMIT 1`
        )
        .get(existingTarget.id, ...sourceIds) as { sourceId: string } | undefined;
      if (duplicate) return reply.code(409).send({ error: 'ALREADY_IMPORTED', itemId: duplicate.sourceId });
    }
    const timestamp = now();
    const createdIds: string[] = [];
    try {
      sqlite.transaction(() => {
        const targetReport = ensureReport(user.workspaceId, user.id, target.year, target.week);
        const positions = new Map<ReportItemType, number>();
        reportItemTypes.forEach((type) => {
          const next = sqlite
            .prepare(
              'SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_items WHERE report_id=? AND type=?'
            )
            .get(targetReport.id, type) as { position: number };
          positions.set(type, next.position);
        });
        const insertItem = sqlite.prepare(
          'INSERT INTO report_items(id,report_id,imported_from_item_id,project_id,category_id,type,content_md,occurred_on,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        const copyTags = sqlite.prepare(
          'INSERT INTO report_item_tags(report_item_id,tag_id) SELECT ?,tag_id FROM report_item_tags WHERE report_item_id=?'
        );
        orderedSources.forEach((source) => {
          const itemId = id();
          const position = positions.get(source.type) ?? 0;
          insertItem.run(
            itemId,
            targetReport.id,
            source.id,
            source.projectId ?? source.project_id ?? null,
            source.categoryId ?? source.category_id ?? null,
            source.type,
            source.contentMd ?? source.content_md ?? '',
            null,
            'incomplete',
            source.note ?? '',
            position,
            1,
            timestamp,
            timestamp
          );
          copyTags.run(itemId, source.id);
          positions.set(source.type, position + 1);
          createdIds.push(itemId);
        });
        sqlite
          .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
          .run(timestamp, targetReport.id);
      })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE'))
        return reply.code(409).send({ error: 'ALREADY_IMPORTED' });
      throw error;
    }
    const created = createdIds.map((itemId) => {
      const row = sqlite
        .prepare(
          'SELECT id,report_id AS reportId,imported_from_item_id AS importedFromItemId,project_id AS projectId,category_id AS categoryId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version FROM report_items WHERE id=?'
        )
        .get(itemId) as ReportItemRow;
      return serializeReportItem(row);
    });
    return reply.code(201).send({ items: created });
  });
  app.post('/api/reports/:id/items', { preHandler: requireUser }, async (request, reply) => {
    const { id: reportId } = uuidParam.parse(request.params);
    const input = reportItemInputSchema.parse(request.body);
    const user = request.currentUser!;
    const report = sqlite
      .prepare('SELECT id FROM weekly_reports WHERE id=? AND workspace_id=? AND author_id=?')
      .get(reportId, user.workspaceId, user.id);
    if (!report) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!validProjectId(input.projectId ?? null, user.workspaceId))
      return reply.code(400).send({ error: 'INVALID_PROJECT', message: '项目不可用' });
    if (!validCategoryId(input.categoryId ?? null, user.workspaceId))
      return reply.code(400).send({ error: 'INVALID_CATEGORY', message: '分类不可用' });
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
          'INSERT INTO report_items(id,report_id,project_id,category_id,type,content_md,occurred_on,progress,note,position,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          itemId,
          reportId,
          input.projectId ?? null,
          input.categoryId ?? null,
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
      replaceTags(itemId, input.tagIds, user.workspaceId);
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(timestamp, reportId);
    })();
    return reply.code(201).send({
      id: itemId,
      reportId,
      importedFromItemId: null,
      projectId: input.projectId ?? null,
      categoryId: input.categoryId ?? null,
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
    if (
      body.projectId !== undefined &&
      body.projectId !== current.project_id &&
      !validProjectId(body.projectId, user.workspaceId)
    )
      return reply.code(400).send({ error: 'INVALID_PROJECT', message: '项目不可用' });
    if (
      body.categoryId !== undefined &&
      body.categoryId !== current.category_id &&
      !validCategoryId(body.categoryId, user.workspaceId)
    )
      return reply.code(400).send({ error: 'INVALID_CATEGORY', message: '分类不可用' });
    const timestamp = now();
    sqlite.transaction(() => {
      const result = sqlite
        .prepare(
          'UPDATE report_items SET project_id=?,category_id=?,type=?,content_md=?,occurred_on=?,progress=?,note=?,position=?,version=version+1,updated_at=? WHERE id=? AND version=?'
        )
        .run(
          body.projectId === undefined ? current.project_id : body.projectId,
          body.categoryId === undefined ? current.category_id : body.categoryId,
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
      if (body.tagIds) replaceTags(itemId, body.tagIds, user.workspaceId);
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(timestamp, current.report_id);
    })();
    const row = sqlite
      .prepare(
        'SELECT id,report_id AS reportId,imported_from_item_id AS importedFromItemId,project_id AS projectId,category_id AS categoryId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version FROM report_items WHERE id=?'
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
      .object({
        type: z.enum(reportItemTypes),
        ids: z.array(z.string().uuid()),
        move: z
          .object({
            itemId: z.string().uuid(),
            projectId: z.string().uuid().nullable(),
            categoryId: z.string().uuid().nullable(),
            expectedVersion: z.number().int().positive()
          })
          .optional()
      })
      .parse(request.body);
    const user = request.currentUser!;
    const report = sqlite
      .prepare('SELECT 1 FROM weekly_reports WHERE id=? AND workspace_id=? AND author_id=?')
      .get(reportId, user.workspaceId, user.id);
    if (!report) return reply.code(404).send({ error: 'NOT_FOUND' });
    const currentItems = sqlite
      .prepare('SELECT id FROM report_items WHERE report_id=? AND type=?')
      .all(reportId, body.type) as Array<{ id: string }>;
    if (
      body.ids.length !== currentItems.length ||
      new Set(body.ids).size !== body.ids.length ||
      currentItems.some((item) => !body.ids.includes(item.id))
    )
      return reply.code(400).send({ error: 'INVALID_REORDER', message: '排序条目不完整' });

    let moved: ReportItemRow | undefined;
    if (body.move) {
      moved = sqlite
        .prepare('SELECT * FROM report_items WHERE id=? AND report_id=? AND type=?')
        .get(body.move.itemId, reportId, body.type) as ReportItemRow | undefined;
      if (!moved) return reply.code(400).send({ error: 'INVALID_MOVE' });
      if (moved.version !== body.move.expectedVersion)
        return reply.code(409).send({ error: 'VERSION_CONFLICT', current: serializeReportItem(moved) });
      if (!validProjectId(body.move.projectId, user.workspaceId))
        return reply.code(400).send({ error: 'INVALID_PROJECT', message: '项目不可用' });
      if (!validCategoryId(body.move.categoryId, user.workspaceId))
        return reply.code(400).send({ error: 'INVALID_CATEGORY', message: '分类不可用' });
    }

    const timestamp = now();
    const updatePosition = sqlite.prepare(
      'UPDATE report_items SET position=?,updated_at=? WHERE id=? AND report_id=? AND type=?'
    );
    sqlite.transaction(() => {
      if (body.move) {
        const result = sqlite
          .prepare(
            'UPDATE report_items SET project_id=?,category_id=?,version=version+1,updated_at=? WHERE id=? AND report_id=? AND type=? AND version=?'
          )
          .run(
            body.move.projectId,
            body.move.categoryId,
            timestamp,
            body.move.itemId,
            reportId,
            body.type,
            body.move.expectedVersion
          );
        if (!result.changes) throw new Error('VERSION_CONFLICT');
      }
      body.ids.forEach((itemId, index) => updatePosition.run(index, timestamp, itemId, reportId, body.type));
      sqlite
        .prepare('UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?')
        .run(timestamp, reportId);
    })();
    const movedItem = body.move
      ? (sqlite
          .prepare(
            'SELECT id,report_id AS reportId,imported_from_item_id AS importedFromItemId,project_id AS projectId,category_id AS categoryId,type,content_md AS contentMd,occurred_on AS occurredOn,progress,note,position,version FROM report_items WHERE id=?'
          )
          .get(body.move.itemId) as ReportItemRow)
      : null;
    return { ok: true, movedItem: movedItem ? serializeReportItem(movedItem) : null };
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
    const where = ['wr.workspace_id=?', 'wr.author_id=?'];
    const args: Array<string | number> = [request.currentUser!.workspaceId, request.currentUser!.id];
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
