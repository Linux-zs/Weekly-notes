import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { now, sqlite } from '../db/index.js';
import { createBackup } from '../services/backup.js';
import { importHolidayYear } from '../services/holidays.js';
import { requireUser } from '../types.js';

function directoryStats(directory: string) {
  if (!fs.existsSync(directory)) return { files: 0, bytes: 0 };
  let files = 0,
    bytes = 0;
  const visit = (target: string) => {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) visit(child);
      else {
        files++;
        bytes += fs.statSync(child).size;
      }
    }
  };
  visit(directory);
  return { files, bytes };
}

function backupEntries() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs
    .readdirSync(config.backupDir, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith('zhoubao-'))
    .map((entry) => {
      const target = path.join(config.backupDir, entry.name);
      const stats = entry.isDirectory()
        ? directoryStats(target)
        : { files: 1, bytes: fs.statSync(target).size };
      return { name: entry.name, createdAt: fs.statSync(target).mtime.toISOString(), ...stats };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
}

function validateTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function registerSettings(app: FastifyInstance) {
  app.get('/api/settings', { preHandler: requireUser }, async (request) => {
    const user = request.currentUser!;
    const profile = sqlite
      .prepare('SELECT display_name AS displayName,email,timezone FROM users WHERE id=?')
      .get(user.id);
    const workspace = sqlite.prepare('SELECT id,name,type FROM workspaces WHERE id=?').get(user.workspaceId);
    const workspaces = sqlite
      .prepare(
        'SELECT w.id,w.name,w.type,wm.role FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=? ORDER BY wm.created_at'
      )
      .all(user.id);
    const members = sqlite
      .prepare(
        'SELECT u.id,u.display_name AS displayName,u.email,u.avatar_url AS avatarUrl,wm.role,wm.created_at AS joinedAt FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? ORDER BY wm.role DESC,wm.created_at'
      )
      .all(user.workspaceId);
    const invitations =
      user.role === 'owner'
        ? sqlite
            .prepare(
              "SELECT id,email,role,expires_at AS expiresAt,created_at AS createdAt FROM workspace_invitations WHERE workspace_id=? AND status='pending' AND expires_at>? ORDER BY created_at DESC"
            )
            .all(user.workspaceId, now())
        : [];
    const databaseBytes = fs.existsSync(config.databasePath) ? fs.statSync(config.databasePath).size : 0;
    const uploads = directoryStats(config.uploadDir);
    const holidayYears = sqlite
      .prepare(
        'SELECT source_year AS year,COUNT(*) AS dayCount,MAX(source_url) AS sourceUrl FROM calendar_days GROUP BY source_year ORDER BY source_year DESC'
      )
      .all();
    return {
      profile,
      workspace,
      workspaces,
      members,
      invitations,
      role: user.role,
      status: {
        databaseBytes,
        uploads,
        backups: backupEntries(),
        holidayYears,
        backupSchedule: '03:00',
        retentionDays: 30
      }
    };
  });
  app.patch('/api/settings/profile', { preHandler: requireUser }, async (request) => {
    const input = z
      .object({
        displayName: z.string().trim().min(1).max(80),
        timezone: z.string().min(1).max(80).refine(validateTimezone, '无效的时区')
      })
      .parse(request.body);
    sqlite
      .prepare('UPDATE users SET display_name=?,timezone=?,updated_at=? WHERE id=?')
      .run(input.displayName, input.timezone, now(), request.currentUser!.id);
    return input;
  });
  app.patch('/api/settings/workspace', { preHandler: requireUser }, async (request, reply) => {
    if (request.currentUser!.role !== 'owner')
      return reply.code(403).send({ error: 'FORBIDDEN', message: '只有空间所有者可以修改空间设置' });
    const input = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
    sqlite
      .prepare('UPDATE workspaces SET name=?,updated_at=? WHERE id=?')
      .run(input.name, now(), request.currentUser!.workspaceId);
    return input;
  });
  app.post('/api/settings/workspace/switch', { preHandler: requireUser }, async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.body);
    const membership = sqlite
      .prepare('SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?')
      .get(workspaceId, request.currentUser!.id);
    if (!membership) return reply.code(403).send({ error: 'FORBIDDEN', message: '你不是该空间的成员' });
    const raw = request.cookies[config.SESSION_COOKIE_NAME];
    if (!raw) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    sqlite
      .prepare('UPDATE sessions SET workspace_id=?,last_seen_at=? WHERE token_hash=?')
      .run(workspaceId, now(), sha256(raw));
    return { ok: true };
  });
  app.post('/api/settings/invitations', { preHandler: requireUser }, async (request, reply) => {
    const user = request.currentUser!;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const { email } = z
      .object({
        email: z
          .string()
          .email()
          .transform((value) => value.toLowerCase())
      })
      .parse(request.body);
    const member = sqlite
      .prepare(
        'SELECT 1 FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND LOWER(u.email)=?'
      )
      .get(user.workspaceId, email);
    if (member) return reply.code(409).send({ error: 'ALREADY_MEMBER', message: '该邮箱已经是空间成员' });
    const existing = sqlite
      .prepare("SELECT id FROM workspace_invitations WHERE workspace_id=? AND email=? AND status='pending'")
      .get(user.workspaceId, email);
    if (existing) return reply.code(409).send({ error: 'ALREADY_INVITED', message: '该邮箱已有待接受邀请' });
    const invitationId = crypto.randomUUID();
    const timestamp = now();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    sqlite
      .prepare(
        'INSERT INTO workspace_invitations(id,workspace_id,email,role,status,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)'
      )
      .run(invitationId, user.workspaceId, email, 'member', 'pending', user.id, expiresAt, timestamp);
    sqlite
      .prepare("UPDATE workspaces SET type='team',updated_at=? WHERE id=?")
      .run(timestamp, user.workspaceId);
    return reply.code(201).send({ id: invitationId, email, role: 'member', expiresAt, createdAt: timestamp });
  });
  app.delete('/api/settings/invitations/:id', { preHandler: requireUser }, async (request, reply) => {
    if (request.currentUser!.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    sqlite
      .prepare(
        "UPDATE workspace_invitations SET status='revoked' WHERE id=? AND workspace_id=? AND status='pending'"
      )
      .run(id, request.currentUser!.workspaceId);
    return reply.code(204).send();
  });
  app.delete('/api/settings/members/:id', { preHandler: requireUser }, async (request, reply) => {
    const user = request.currentUser!;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const { id: memberId } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (memberId === user.id)
      return reply.code(409).send({ error: 'OWNER_REQUIRED', message: '不能移除当前空间所有者' });
    const member = sqlite
      .prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?')
      .get(user.workspaceId, memberId) as { role: string } | undefined;
    if (!member) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (member.role === 'owner')
      return reply.code(409).send({ error: 'OWNER_REQUIRED', message: '不能移除空间所有者' });
    sqlite
      .prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?')
      .run(user.workspaceId, memberId);
    sqlite
      .prepare('UPDATE sessions SET workspace_id=NULL WHERE user_id=? AND workspace_id=?')
      .run(memberId, user.workspaceId);
    return reply.code(204).send();
  });
  app.post('/api/settings/backup', { preHandler: requireUser }, async (request, reply) => {
    if (request.currentUser!.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const destination = await createBackup();
    return { name: path.basename(destination), createdAt: fs.statSync(destination).mtime.toISOString() };
  });
  app.post('/api/settings/holidays/:year/import', { preHandler: requireUser }, async (request, reply) => {
    if (request.currentUser!.role !== 'owner') return reply.code(403).send({ error: 'FORBIDDEN' });
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2200) }).parse(request.params);
    try {
      return importHolidayYear(year);
    } catch (error) {
      return reply.code(404).send({
        error: 'HOLIDAY_FILE_NOT_FOUND',
        message: error instanceof Error ? error.message : '节假日导入失败'
      });
    }
  });
  app.get('/api/settings/export', { preHandler: requireUser }, async (request, reply) => {
    const user = request.currentUser!;
    const workspaceId = user.workspaceId;
    const payload = {
      exportedAt: now(),
      profile: sqlite
        .prepare(
          'SELECT id,display_name AS displayName,email,timezone,created_at AS createdAt FROM users WHERE id=?'
        )
        .get(user.id),
      workspace: sqlite
        .prepare('SELECT id,name,type,created_at AS createdAt FROM workspaces WHERE id=?')
        .get(workspaceId),
      projects: sqlite
        .prepare(
          'SELECT id,name,color,position,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE workspace_id=?'
        )
        .all(workspaceId),
      tags: sqlite.prepare('SELECT id,name,color FROM tags WHERE workspace_id=?').all(workspaceId),
      reports: sqlite
        .prepare(
          'SELECT id,week_year AS weekYear,week_number AS weekNumber,week_start AS weekStart,week_end AS weekEnd,created_at AS createdAt,updated_at AS updatedAt FROM weekly_reports WHERE workspace_id=? AND author_id=?'
        )
        .all(workspaceId, user.id),
      reportItems: sqlite
        .prepare(
          'SELECT ri.id,ri.report_id AS reportId,ri.project_id AS projectId,ri.type,ri.content_md AS contentMd,ri.occurred_on AS occurredOn,ri.progress,ri.note,ri.position,ri.created_at AS createdAt,ri.updated_at AS updatedAt FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE wr.workspace_id=? AND wr.author_id=?'
        )
        .all(workspaceId, user.id),
      memos: sqlite
        .prepare(
          'SELECT id,project_id AS projectId,title,content_md AS contentMd,color,pinned,archived_at AS archivedAt,converted_report_item_id AS convertedReportItemId,created_at AS createdAt,updated_at AS updatedAt FROM memo_cards WHERE workspace_id=? AND author_id=?'
        )
        .all(workspaceId, user.id),
      attachments: sqlite
        .prepare(
          'SELECT id,report_item_id AS reportItemId,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,created_at AS createdAt FROM report_attachments WHERE workspace_id=? AND author_id=?'
        )
        .all(workspaceId, user.id)
    };
    const date = now().slice(0, 10);
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="weekly-report-export-${date}.json"`)
      .send(JSON.stringify(payload, null, 2));
  });
}
