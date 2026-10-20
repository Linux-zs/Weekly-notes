import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import path from 'node:path';
import { sqlite } from '../db/index.js';
import { config } from '../config.js';
import { requireUser } from '../types.js';
import { removeStoredFile, withStorageLock } from '../services/storage.js';

const departed = `NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=wr.workspace_id AND wm.user_id=wr.author_id)`;

export async function registerDepartedReports(app: FastifyInstance) {
  app.get('/api/settings/departed-reports', { preHandler: requireUser }, async (request, reply) => {
    const user = request.currentUser!;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(request.query);
    const rows = sqlite
      .prepare(
        `SELECT wr.id,wr.week_year AS weekYear,wr.week_number AS weekNumber,u.display_name AS authorName
      FROM weekly_reports wr JOIN users u ON u.id=wr.author_id WHERE wr.workspace_id=? AND ${departed}
      ORDER BY wr.week_start DESC,wr.id LIMIT 21 OFFSET ?`
      )
      .all(user.workspaceId, (page - 1) * 20) as Array<{
      id: string;
      weekYear: number;
      weekNumber: number;
      authorName: string;
    }>;
    const reports = rows.slice(0, 20);
    const items = reports.length
      ? (sqlite
          .prepare(
            `SELECT ri.id,ri.report_id AS reportId,ri.content_md AS contentMd,ri.note,p.name AS projectName
      FROM report_items ri LEFT JOIN projects p ON p.id=ri.project_id
      WHERE ri.report_id IN (${reports.map(() => '?').join(',')}) ORDER BY ri.type,ri.position,ri.id`
          )
          .all(...reports.map((report) => report.id)) as Array<{
          reportId: string;
          id: string;
          contentMd: string;
          note: string;
          projectName: string | null;
        }>)
      : [];
    return {
      reports: reports.map((report) => ({
        ...report,
        items: items.filter((item) => item.reportId === report.id)
      })),
      hasMore: rows.length > 20
    };
  });
  app.delete('/api/settings/departed-reports/:id', { preHandler: requireUser }, async (request, reply) => {
    const user = request.currentUser!;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return withStorageLock(async () => {
      const result = sqlite.transaction(() => {
        const report = sqlite
          .prepare(`SELECT wr.id FROM weekly_reports wr WHERE wr.id=? AND wr.workspace_id=? AND ${departed}`)
          .get(id, user.workspaceId);
        if (!report) return null;
        const files = sqlite
          .prepare(
            'SELECT stored_name AS storedName FROM report_attachments WHERE report_item_id IN (SELECT id FROM report_items WHERE report_id=?)'
          )
          .all(id) as Array<{ storedName: string }>;
        sqlite.prepare('DELETE FROM weekly_reports WHERE id=?').run(id);
        return files;
      })();
      if (!result) return reply.code(404).send({ error: 'NOT_FOUND' });
      for (const file of result) {
        const target = path.resolve(config.uploadDir, file.storedName);
        if (target.startsWith(path.resolve(config.uploadDir) + path.sep))
          removeStoredFile(target, request.log, 'Removed-member attachment cleanup failed');
      }
      return reply.code(204).send();
    });
  });
}
