import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = new URL('../backend/migrations/', import.meta.url);

/**
 * File-backed node:sqlite implementation of the M0 SqlDatabase port (backend/src/adapters/sql).
 * Same batch contract as backend/test/support/sqlite.ts: one transaction, any error rolls back.
 * Applies backend/migrations in order once per file. Not a D1 emulator; workerd/D1 is checked
 * separately by backend/scripts/workerd-smoke.mjs.
 */
export class SqliteDatabase {
  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), {recursive: true});
    this.connection = new DatabaseSync(file);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.connection.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
    const applied = new Set(this.connection.prepare('SELECT name FROM _local_migrations').all().map(r => r.name));
    for (const name of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).sort()) {
      if (applied.has(name)) continue;
      this.connection.exec('BEGIN IMMEDIATE');
      try {
        this.connection.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
        this.connection.prepare('INSERT INTO _local_migrations (name) VALUES (?)').run(name);
        this.connection.exec('COMMIT');
      } catch (e) {this.connection.exec('ROLLBACK'); throw e;}
    }
  }
  async batch(statements) {
    await Promise.resolve(); // yield like a network call so concurrent callers interleave
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const out = statements.map(s => ({changes: Number(this.connection.prepare(s.sql).run(...s.params).changes)}));
      this.connection.exec('COMMIT');
      return out;
    } catch (e) {this.connection.exec('ROLLBACK'); throw e;}
  }
  async all(statement) {
    await Promise.resolve();
    return this.connection.prepare(statement.sql).all(...statement.params);
  }
  close() {this.connection.close();}
}
