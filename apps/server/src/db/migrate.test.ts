import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';

let sqlite: Database.Database | undefined;

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

describe('database migrations', () => {
  it('moves legacy risk items into other records', () => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version,applied_at) VALUES
        (1,'2026-01-01'),(2,'2026-01-01'),(3,'2026-01-01'),(4,'2026-01-01'),(5,'2026-01-01');
      CREATE TABLE report_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('completed','next_plan','risk','other'))
      );
      INSERT INTO report_items(id,type) VALUES('legacy-risk','risk');
    `);

    runMigrations(sqlite);

    expect(sqlite.prepare('SELECT type FROM report_items WHERE id=?').get('legacy-risk')).toEqual({
      type: 'other'
    });
    expect(sqlite.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({
      version: 7
    });
  });

  it('adds an empty category catalog without changing existing report items', () => {
    sqlite = new Database(':memory:');
    runMigrations(sqlite);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM report_categories').get()).toEqual({ count: 0 });
    expect(
      sqlite.prepare("SELECT name FROM pragma_table_info('report_items') WHERE name='category_id'").get()
    ).toEqual({ name: 'category_id' });
  });
});
