// Cloudflare D1 adapter. Structural types keep the domain free of Workers binding types;
// this file is the only place that knows about D1.

import type { SqlDatabase, SqlStatement } from "../sql/sqlDatabase.ts";

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<{ results: T[] }>;
}

interface D1ResultLike {
  meta: { changes?: number };
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
}

export class D1Database implements SqlDatabase {
  readonly db: D1DatabaseLike;
  constructor(db: D1DatabaseLike) {
    this.db = db;
  }

  async batch(statements: SqlStatement[]): Promise<{ changes: number }[]> {
    const results = await this.db.batch(statements.map((s) => this.db.prepare(s.sql).bind(...s.params)));
    return results.map((r) => ({ changes: r.meta.changes ?? 0 }));
  }

  async all<T>(statement: SqlStatement): Promise<T[]> {
    return (await this.db.prepare(statement.sql).bind(...statement.params).all<T>()).results;
  }
}
