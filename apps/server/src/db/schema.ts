import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
};

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  ...timestamps
});
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  timezone: text('timezone').notNull(),
  ...timestamps
});
export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
);
export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull()
  },
  (t) => [uniqueIndex('auth_provider_subject_uq').on(t.provider, t.subject)]
);
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull()
});
export const workspaceInvitations = sqliteTable('workspace_invitations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  invitedBy: text('invited_by').notNull(),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  createdAt: text('created_at').notNull()
});
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  position: integer('position').notNull(),
  archivedAt: text('archived_at'),
  ...timestamps
});
export const weeklyReports = sqliteTable(
  'weekly_reports',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    authorId: text('author_id').notNull(),
    weekYear: integer('week_year').notNull(),
    weekNumber: integer('week_number').notNull(),
    weekStart: text('week_start').notNull(),
    weekEnd: text('week_end').notNull(),
    version: integer('version').notNull(),
    ...timestamps
  },
  (t) => [uniqueIndex('weekly_report_owner_week_uq').on(t.workspaceId, t.authorId, t.weekYear, t.weekNumber)]
);
export const reportItems = sqliteTable('report_items', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull(),
  projectId: text('project_id'),
  type: text('type').notNull(),
  contentMd: text('content_md').notNull(),
  occurredOn: text('occurred_on'),
  progress: text('progress').notNull(),
  note: text('note').notNull(),
  position: integer('position').notNull(),
  version: integer('version').notNull(),
  ...timestamps
});
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    color: text('color').notNull(),
    ...timestamps
  },
  (t) => [uniqueIndex('tag_workspace_name_uq').on(t.workspaceId, t.normalizedName)]
);
export const reportItemTags = sqliteTable(
  'report_item_tags',
  {
    reportItemId: text('report_item_id').notNull(),
    tagId: text('tag_id').notNull()
  },
  (t) => [primaryKey({ columns: [t.reportItemId, t.tagId] })]
);
export const reportAttachments = sqliteTable('report_attachments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  authorId: text('author_id').notNull(),
  reportItemId: text('report_item_id').notNull(),
  originalName: text('original_name').notNull(),
  storedName: text('stored_name').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull()
});
export const memoCards = sqliteTable('memo_cards', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  authorId: text('author_id').notNull(),
  projectId: text('project_id'),
  title: text('title').notNull(),
  contentMd: text('content_md').notNull(),
  color: text('color').notNull(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull(),
  archivedAt: text('archived_at'),
  convertedReportItemId: text('converted_report_item_id'),
  version: integer('version').notNull(),
  ...timestamps
});
export const memoCardTags = sqliteTable(
  'memo_card_tags',
  {
    memoCardId: text('memo_card_id').notNull(),
    tagId: text('tag_id').notNull()
  },
  (t) => [primaryKey({ columns: [t.memoCardId, t.tagId] })]
);
export const calendarDays = sqliteTable('calendar_days', {
  date: text('date').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  sourceYear: integer('source_year').notNull(),
  sourceUrl: text('source_url'),
  note: text('note')
});
