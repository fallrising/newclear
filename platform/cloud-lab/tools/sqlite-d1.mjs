// Local test boundary only. This exercises SQL but is not a workerd/D1 emulator.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export class SQLiteD1 {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE name='commands'").get()) {
      this.db.exec(readFileSync(new URL('../apps/control/migrations/0001.sql', import.meta.url), 'utf8'));
    }
  }
  prepare(sql) {
    const db = this.db;
    function statement(params) {
      return { sql, params,
        bind: (...next) => statement(next),
        async first() { return db.prepare(sql).get(...params) || null; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async run() { return { meta: { changes: db.prepare(sql).run(...params).changes } }; },
      };
    }
    return statement([]);
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const output = statements.map(({ sql, params }) => {
        const statement = this.db.prepare(sql);
        return statement.columns().length ? { results: statement.all(...params) } :
          { meta: { changes: statement.run(...params).changes } };
      });
      this.db.exec('COMMIT');
      return output;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
