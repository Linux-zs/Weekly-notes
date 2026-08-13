import type Database from 'better-sqlite3';

export const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT, avatar_url TEXT, timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','member')), created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, subject TEXT NOT NULL, email TEXT, display_name TEXT, last_login_at TEXT, created_at TEXT NOT NULL, UNIQUE(provider,subject));
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_flows (id TEXT PRIMARY KEY, provider TEXT NOT NULL, state TEXT NOT NULL, verifier TEXT, nonce TEXT, link_user_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weekly_reports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, week_year INTEGER NOT NULL, week_number INTEGER NOT NULL, week_start TEXT NOT NULL, week_end TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id,author_id,week_year,week_number));
CREATE TABLE IF NOT EXISTS report_items (id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, type TEXT NOT NULL CHECK(type IN ('completed','next_plan','other')), content_md TEXT NOT NULL DEFAULT '', occurred_on TEXT, position INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, normalized_name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id,normalized_name));
CREATE TABLE IF NOT EXISTS report_item_tags (report_item_id TEXT NOT NULL REFERENCES report_items(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(report_item_id,tag_id));
CREATE TABLE IF NOT EXISTS calendar_days (date TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('holiday','adjusted_workday')), name TEXT NOT NULL, source_year INTEGER NOT NULL, source_url TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id,archived_at,position);
CREATE INDEX IF NOT EXISTS idx_reports_week ON weekly_reports(workspace_id,week_start DESC);
CREATE INDEX IF NOT EXISTS idx_items_report ON report_items(report_id,type,position);
CREATE INDEX IF NOT EXISTS idx_items_project ON report_items(project_id);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON report_item_tags(tag_id,report_item_id);
CREATE INDEX IF NOT EXISTS idx_calendar_year ON calendar_days(source_year,date);`,
  `CREATE TABLE IF NOT EXISTS report_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_item_id TEXT NOT NULL REFERENCES report_items(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_attachments_item ON report_attachments(report_item_id,created_at);`,
  `ALTER TABLE report_items ADD COLUMN progress TEXT NOT NULL DEFAULT 'incomplete' CHECK(progress IN ('completed','answered','incomplete'));
ALTER TABLE report_items ADD COLUMN note TEXT NOT NULL DEFAULT '';
UPDATE report_items SET progress='completed' WHERE type='completed';`,
  `ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE sessions SET workspace_id=(SELECT workspace_id FROM workspace_members WHERE user_id=sessions.user_id ORDER BY created_at LIMIT 1);
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email ON workspace_invitations(email,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id,user_id);`,
  `DROP TABLE IF EXISTS memo_card_tags;
DROP TABLE IF EXISTS memo_cards;`,
  `UPDATE report_items SET type='other' WHERE type='risk';`,
  `CREATE TABLE IF NOT EXISTS report_categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id,normalized_name)
);
ALTER TABLE report_items ADD COLUMN category_id TEXT REFERENCES report_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_report_categories_workspace ON report_categories(workspace_id,archived_at,position);
CREATE INDEX IF NOT EXISTS idx_items_category ON report_items(category_id);`
];

export function runMigrations(sqlite: Database.Database) {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  );
  const applied = new Set(
    (sqlite.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version
    )
  );
  migrations.forEach((sql, index) => {
    const version = index + 1;
    if (applied.has(version)) return;
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)')
        .run(version, new Date().toISOString());
    })();
  });
}
