// Local stand-in for D1 using node:sqlite. It reproduces the batch contract the stores rely on
// (one transaction; any statement error rolls back everything; 0-row statements are not errors).
// It is NOT D1: platform behaviour must still be confirmed in workerd/D1 (see docs/STATUS.md).

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Clock, IdSource, SqlDatabase, SqlStatement } from "../../src/adapters/sql/sqlDatabase.ts";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

export class SqliteDatabase implements SqlDatabase {
  readonly db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      this.db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
    }
  }

  async batch(statements: SqlStatement[]): Promise<{ changes: number }[]> {
    await Promise.resolve(); // yield like a network call so concurrent callers interleave
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = statements.map((s) => ({ changes: Number(this.db.prepare(s.sql).run(...s.params).changes) }));
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async all<T>(statement: SqlStatement): Promise<T[]> {
    await Promise.resolve();
    return this.db.prepare(statement.sql).all(...statement.params) as T[];
  }

  count(table: string, where = "1 = 1", ...params: (string | number)[]): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number };
    return Number(row.n);
  }

  exec(text: string, ...params: (string | number | null)[]): void {
    this.db.prepare(text).run(...params);
  }
}

export class FakeClock implements Clock {
  t: number;
  constructor(t = 1767225600) {
    this.t = t; // 2026-01-01T00:00:00Z
  }
  now(): number {
    return this.t;
  }
}

export class SeqIds implements IdSource {
  n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `${prefix}_${String(this.n).padStart(6, "0")}`;
  }
}
