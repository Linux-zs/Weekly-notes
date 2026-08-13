import type { FastifyInstance } from 'fastify';
import { projectInputSchema, reportCategoryInputSchema } from '@zhoubao/shared';
import { z } from 'zod';
import { id, now, sqlite } from '../db/index.js';
import { requireUser } from '../types.js';

const uuidParam = z.object({ id: z.string().uuid() });
const categoryCreateInput = reportCategoryInputSchema.extend({
  assignments: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        expectedVersion: z.number().int().positive()
      })
    )
    .max(500)
    .optional()
});
const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#78909C')
});

interface ProjectRow {
  name: string;
  color: string;
  position: number;
  archived_at: string | null;
}

interface TagRow {
  name: string;
  color: string;
}

interface CategoryRow {
  name: string;
  position: number;
  archived_at: string | null;
}

interface CategoryAssignmentRow {
  id: string;
  reportId: string;
  categoryId: string | null;
  version: number;
}

const normalizeCategoryName = (name: string) => name.normalize('NFKC').toLocaleLowerCase('zh-CN');

export async function registerCatalog(app: FastifyInstance) {
  app.get('/api/categories', { preHandler: requireUser }, async (request) => ({
    categories: sqlite
      .prepare(
        'SELECT id,name,position,archived_at AS archivedAt FROM report_categories WHERE workspace_id=? ORDER BY archived_at IS NOT NULL,position,name COLLATE NOCASE'
      )
      .all(request.currentUser!.workspaceId)
  }));

  app.post('/api/categories', { preHandler: requireUser }, async (request, reply) => {
    const input = categoryCreateInput.parse(request.body);
    const assignments = input.assignments ?? [];
    const assignmentIds = assignments.map((assignment) => assignment.itemId);
    if (new Set(assignmentIds).size !== assignmentIds.length)
      return reply.code(400).send({ error: 'DUPLICATE_CATEGORY_ASSIGNMENT' });
    let assignmentRows: CategoryAssignmentRow[] = [];
    if (assignments.length) {
      const placeholders = assignments.map(() => '?').join(',');
      assignmentRows = sqlite
        .prepare(
          `SELECT ri.id,ri.report_id AS reportId,ri.category_id AS categoryId,ri.version
           FROM report_items ri
           JOIN weekly_reports wr ON wr.id=ri.report_id
           WHERE ri.id IN (${placeholders}) AND wr.workspace_id=? AND wr.author_id=?`
        )
        .all(
          ...assignmentIds,
          request.currentUser!.workspaceId,
          request.currentUser!.id
        ) as CategoryAssignmentRow[];
      if (assignmentRows.length !== assignments.length)
        return reply.code(400).send({ error: 'INVALID_CATEGORY_ASSIGNMENT' });
      const assignmentById = new Map(assignments.map((assignment) => [assignment.itemId, assignment]));
      const conflict = assignmentRows.find(
        (row) => row.categoryId !== null || row.version !== assignmentById.get(row.id)?.expectedVersion
      );
      if (conflict)
        return reply.code(409).send({ error: 'CATEGORY_ASSIGNMENT_CONFLICT', itemId: conflict.id });
    }
    const categoryId = id();
    const timestamp = now();
    const next = sqlite
      .prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_categories WHERE workspace_id=?')
      .get(request.currentUser!.workspaceId) as { position: number };
    try {
      sqlite.transaction(() => {
        sqlite
          .prepare(
            'INSERT INTO report_categories(id,workspace_id,name,normalized_name,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
          )
          .run(
            categoryId,
            request.currentUser!.workspaceId,
            input.name,
            normalizeCategoryName(input.name),
            next.position,
            timestamp,
            timestamp
          );
        if (!assignments.length) return;
        const updateItem = sqlite.prepare(
          'UPDATE report_items SET category_id=?,version=version+1,updated_at=? WHERE id=? AND category_id IS NULL AND version=?'
        );
        assignments.forEach((assignment) => {
          const result = updateItem.run(categoryId, timestamp, assignment.itemId, assignment.expectedVersion);
          if (!result.changes) throw new Error('CATEGORY_ASSIGNMENT_CONFLICT');
        });
        const reportIds = new Set(assignmentRows.map((row) => row.reportId));
        const updateReport = sqlite.prepare(
          'UPDATE weekly_reports SET version=version+1,updated_at=? WHERE id=?'
        );
        reportIds.forEach((reportId) => updateReport.run(timestamp, reportId));
      })();
    } catch (error) {
      if (error instanceof Error && error.message === 'CATEGORY_ASSIGNMENT_CONFLICT')
        return reply.code(409).send({ error: 'CATEGORY_ASSIGNMENT_CONFLICT' });
      return reply.code(409).send({ error: 'CATEGORY_EXISTS', message: '分类已存在' });
    }
    return reply
      .code(201)
      .send({ id: categoryId, name: input.name, position: next.position, archivedAt: null });
  });

  app.post('/api/categories/reorder', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ ids: z.array(z.string().uuid()) }).parse(request.body);
    const workspaceId = request.currentUser!.workspaceId;
    const current = sqlite
      .prepare('SELECT id FROM report_categories WHERE workspace_id=? ORDER BY position,name')
      .all(workspaceId) as Array<{ id: string }>;
    if (
      body.ids.length !== current.length ||
      new Set(body.ids).size !== body.ids.length ||
      current.some((category) => !body.ids.includes(category.id))
    )
      return reply.code(400).send({ error: 'INVALID_CATEGORY_ORDER' });
    const timestamp = now();
    const update = sqlite.prepare(
      'UPDATE report_categories SET position=?,updated_at=? WHERE id=? AND workspace_id=?'
    );
    sqlite.transaction(() =>
      body.ids.forEach((categoryId, position) => update.run(position, timestamp, categoryId, workspaceId))
    )();
    return { ok: true };
  });

  app.patch('/api/categories/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: categoryId } = uuidParam.parse(request.params);
    const input = reportCategoryInputSchema
      .partial()
      .extend({ archived: z.boolean().optional(), position: z.number().int().min(0).optional() })
      .parse(request.body);
    const workspaceId = request.currentUser!.workspaceId;
    const current = sqlite
      .prepare('SELECT name,position,archived_at FROM report_categories WHERE id=? AND workspace_id=?')
      .get(categoryId, workspaceId) as CategoryRow | undefined;
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    const name = input.name ?? current.name;
    const archivedAt = input.archived === undefined ? current.archived_at : input.archived ? now() : null;
    try {
      sqlite
        .prepare(
          'UPDATE report_categories SET name=?,normalized_name=?,position=?,archived_at=?,updated_at=? WHERE id=? AND workspace_id=?'
        )
        .run(
          name,
          normalizeCategoryName(name),
          input.position ?? current.position,
          archivedAt,
          now(),
          categoryId,
          workspaceId
        );
    } catch {
      return reply.code(409).send({ error: 'CATEGORY_EXISTS', message: '分类已存在' });
    }
    return {
      id: categoryId,
      name,
      position: input.position ?? current.position,
      archivedAt
    };
  });

  app.get('/api/projects', { preHandler: requireUser }, async (request) => ({
    projects: sqlite
      .prepare(
        'SELECT id,name,color,archived_at AS archivedAt,position FROM projects WHERE workspace_id=? ORDER BY archived_at IS NOT NULL,position,name'
      )
      .all(request.currentUser!.workspaceId)
  }));

  app.post('/api/projects', { preHandler: requireUser }, async (request, reply) => {
    const input = projectInputSchema.parse(request.body);
    const timestamp = now();
    const projectId = id();
    const max = sqlite
      .prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM projects WHERE workspace_id=?')
      .get(request.currentUser!.workspaceId) as { position: number };
    sqlite
      .prepare(
        'INSERT INTO projects(id,workspace_id,name,color,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
      )
      .run(
        projectId,
        request.currentUser!.workspaceId,
        input.name,
        input.color,
        max.position,
        timestamp,
        timestamp
      );
    return reply.code(201).send({ id: projectId, ...input, archivedAt: null });
  });

  app.patch('/api/projects/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: projectId } = uuidParam.parse(request.params);
    const input = projectInputSchema
      .partial()
      .extend({ archived: z.boolean().optional(), position: z.number().int().min(0).optional() })
      .parse(request.body);
    const current = sqlite
      .prepare('SELECT name,color,position,archived_at FROM projects WHERE id=? AND workspace_id=?')
      .get(projectId, request.currentUser!.workspaceId) as ProjectRow | undefined;
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    sqlite
      .prepare('UPDATE projects SET name=?,color=?,position=?,archived_at=?,updated_at=? WHERE id=?')
      .run(
        input.name ?? current.name,
        input.color ?? current.color,
        input.position ?? current.position,
        input.archived === undefined ? current.archived_at : input.archived ? now() : null,
        now(),
        projectId
      );
    return { ok: true };
  });

  app.delete('/api/projects/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: projectId } = uuidParam.parse(request.params);
    const used = sqlite
      .prepare(
        'SELECT 1 FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE ri.project_id=? AND wr.workspace_id=? LIMIT 1'
      )
      .get(projectId, request.currentUser!.workspaceId);
    if (used)
      return reply.code(409).send({ error: 'PROJECT_IN_USE', message: '项目已被周报引用，请改为归档' });
    sqlite
      .prepare('DELETE FROM projects WHERE id=? AND workspace_id=?')
      .run(projectId, request.currentUser!.workspaceId);
    return reply.code(204).send();
  });

  app.get('/api/tags', { preHandler: requireUser }, async (request) => ({
    tags: sqlite
      .prepare('SELECT id,name,color FROM tags WHERE workspace_id=? ORDER BY name COLLATE NOCASE')
      .all(request.currentUser!.workspaceId)
  }));

  app.post('/api/tags', { preHandler: requireUser }, async (request, reply) => {
    const input = tagInput.parse(request.body);
    const normalized = input.name.toLocaleLowerCase('zh-CN');
    const tagId = id();
    const timestamp = now();
    try {
      sqlite
        .prepare(
          'INSERT INTO tags(id,workspace_id,name,normalized_name,color,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
        )
        .run(
          tagId,
          request.currentUser!.workspaceId,
          input.name,
          normalized,
          input.color,
          timestamp,
          timestamp
        );
    } catch {
      return reply.code(409).send({ error: 'TAG_EXISTS', message: '标签已存在' });
    }
    return reply.code(201).send({ id: tagId, ...input });
  });

  app.patch('/api/tags/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: tagId } = uuidParam.parse(request.params);
    const input = tagInput.partial().parse(request.body);
    const current = sqlite
      .prepare('SELECT name,color FROM tags WHERE id=? AND workspace_id=?')
      .get(tagId, request.currentUser!.workspaceId) as TagRow | undefined;
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    const name = input.name ?? current.name;
    const normalized = name.toLocaleLowerCase('zh-CN');
    try {
      sqlite
        .prepare('UPDATE tags SET name=?,normalized_name=?,color=?,updated_at=? WHERE id=?')
        .run(name, normalized, input.color ?? current.color, now(), tagId);
    } catch {
      return reply.code(409).send({ error: 'TAG_EXISTS', message: '标签已存在' });
    }
    return { id: tagId, name, color: input.color ?? current.color };
  });

  app.delete('/api/tags/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id: tagId } = uuidParam.parse(request.params);
    sqlite
      .prepare('DELETE FROM tags WHERE id=? AND workspace_id=?')
      .run(tagId, request.currentUser!.workspaceId);
    return reply.code(204).send();
  });
}
