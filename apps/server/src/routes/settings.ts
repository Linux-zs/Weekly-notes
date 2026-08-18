import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { id, now, sqlite } from '../db/index.js';
import { detectImage } from '../lib/image.js';
import { requireUser } from '../types.js';
import { ensureWorkspaceForUser } from '../auth.js';

function validateTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const avatarUrlPrefix = '/api/profile-avatars/';
const maxAvatarBytes = 3 * 1024 * 1024;
const avatarFileParam = z.object({ file: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i) });

function avatarDirectory() {
  return path.join(config.uploadDir, 'avatars');
}

function localAvatarPath(avatarUrl: string | null) {
  if (!avatarUrl?.startsWith(avatarUrlPrefix)) return null;
  const file = avatarUrl.slice(avatarUrlPrefix.length);
  if (!avatarFileParam.safeParse({ file }).success) return null;
  return path.join(avatarDirectory(), file);
}

export async function registerSettings(app: FastifyInstance) {
  app.get('/api/settings', { preHandler: requireUser }, async (request) => {
    const user = request.currentUser!;
    const profile = sqlite
      .prepare(
        'SELECT display_name AS displayName,email,timezone,avatar_url AS avatarUrl FROM users WHERE id=?'
      )
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
    return {
      profile,
      workspace,
      workspaces,
      members,
      invitations,
      role: user.role
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
  app.post('/api/settings/avatar', { preHandler: requireUser }, async (request, reply) => {
    let upload;
    try {
      upload = await request.file({ limits: { fileSize: maxAvatarBytes } });
    } catch {
      return reply.code(413).send({ error: 'AVATAR_TOO_LARGE', message: '头像不能超过 3 MB' });
    }
    if (!upload) return reply.code(400).send({ error: 'AVATAR_REQUIRED', message: '请选择头像图片' });
    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return reply.code(413).send({ error: 'AVATAR_TOO_LARGE', message: '头像不能超过 3 MB' });
    }
    const image = detectImage(buffer);
    if (!image)
      return reply
        .code(415)
        .send({ error: 'UNSUPPORTED_AVATAR', message: '仅支持 PNG、JPEG、GIF 或 WebP 图片' });
    const userId = request.currentUser!.id;
    const current = sqlite.prepare('SELECT avatar_url AS avatarUrl FROM users WHERE id=?').get(userId) as
      { avatarUrl: string | null } | undefined;
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    const file = `${id()}.${image.extension}`;
    const directory = avatarDirectory();
    const target = path.join(directory, file);
    const avatarUrl = `${avatarUrlPrefix}${file}`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, buffer, { flag: 'wx' });
    try {
      sqlite.prepare('UPDATE users SET avatar_url=?,updated_at=? WHERE id=?').run(avatarUrl, now(), userId);
    } catch (error) {
      fs.rmSync(target, { force: true });
      throw error;
    }
    const previous = localAvatarPath(current.avatarUrl);
    if (previous) fs.rmSync(previous, { force: true });
    return reply.code(201).send({ avatarUrl });
  });
  app.get('/api/profile-avatars/:file', { preHandler: requireUser }, async (request, reply) => {
    const { file } = avatarFileParam.parse(request.params);
    const avatarUrl = `${avatarUrlPrefix}${file}`;
    const visible = sqlite
      .prepare(
        'SELECT 1 FROM users u JOIN workspace_members wm ON wm.user_id=u.id WHERE u.avatar_url=? AND wm.workspace_id=?'
      )
      .get(avatarUrl, request.currentUser!.workspaceId);
    if (!visible) return reply.code(404).send({ error: 'NOT_FOUND' });
    const target = path.join(avatarDirectory(), file);
    if (!fs.existsSync(target)) return reply.code(404).send({ error: 'FILE_NOT_FOUND' });
    const extension = path.extname(file).slice(1).toLowerCase();
    const mimeType =
      extension === 'png'
        ? 'image/png'
        : extension === 'jpg'
          ? 'image/jpeg'
          : extension === 'gif'
            ? 'image/gif'
            : 'image/webp';
    return reply
      .type(mimeType)
      .header('Content-Length', String(fs.statSync(target).size))
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(fs.createReadStream(target));
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
    sqlite.transaction(() => {
      sqlite
        .prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?')
        .run(user.workspaceId, memberId);
      sqlite
        .prepare('UPDATE sessions SET workspace_id=NULL WHERE user_id=? AND workspace_id=?')
        .run(memberId, user.workspaceId);
      ensureWorkspaceForUser(memberId);
    })();
    return reply.code(204).send();
  });
  app.get('/api/settings/export', { preHandler: requireUser }, async (request, reply) => {
    const user = request.currentUser!;
    const workspaceId = user.workspaceId;
    const payload = {
      exportedAt: now(),
      profile: sqlite
        .prepare(
          'SELECT id,display_name AS displayName,email,timezone,avatar_url AS avatarUrl,created_at AS createdAt FROM users WHERE id=?'
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
      categories: sqlite
        .prepare(
          'SELECT id,name,position,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt FROM report_categories WHERE workspace_id=?'
        )
        .all(workspaceId),
      reports: sqlite
        .prepare(
          'SELECT id,week_year AS weekYear,week_number AS weekNumber,week_start AS weekStart,week_end AS weekEnd,created_at AS createdAt,updated_at AS updatedAt FROM weekly_reports WHERE workspace_id=? AND author_id=?'
        )
        .all(workspaceId, user.id),
      reportItems: sqlite
        .prepare(
          'SELECT ri.id,ri.report_id AS reportId,ri.imported_from_item_id AS importedFromItemId,ri.project_id AS projectId,ri.category_id AS categoryId,ri.type,ri.content_md AS contentMd,ri.occurred_on AS occurredOn,ri.progress,ri.note,ri.position,ri.created_at AS createdAt,ri.updated_at AS updatedAt FROM report_items ri JOIN weekly_reports wr ON wr.id=ri.report_id WHERE wr.workspace_id=? AND wr.author_id=?'
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
