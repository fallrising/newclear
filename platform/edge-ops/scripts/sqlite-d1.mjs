import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Deliberately small D1-shaped SQLite test adapter. Not a Cloudflare runtime claim. */
export class SqliteD1 {
  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), {recursive: true});
    this.connection = new DatabaseSync(file);
    this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.connection.exec(readFileSync(new URL('../backend/migrations/0001_demo.sql', import.meta.url),'utf8'));
  }
  prepare(sql) {return new Statement(this, sql);}
  async batch(statements) {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result=statements.map(s=>s.execute());
      this.connection.exec('COMMIT'); return result;
    } catch (e) {this.connection.exec('ROLLBACK');throw e;}
  }
  close() {this.connection.close();}
}
class Statement {
  constructor(db, sql, params=[]) {this.db=db;this.sql=sql;this.params=params;}
  bind(...params) {return new Statement(this.db,this.sql,params);}
  async first() {return this.db.connection.prepare(this.sql).get(...this.params) ?? null;}
  async all() {return {results:this.db.connection.prepare(this.sql).all(...this.params)};}
  execute() {
    const meta=this.db.connection.prepare(this.sql).run(...this.params);
    return {results:[],meta:{changes:Number(meta.changes)}};
  }
  async run() {return this.execute();}
}
