import {DurableObject} from 'cloudflare:workers';
import roster from '../roster.json';
import {handle, initialState, json} from './core.mjs';

export class OfficeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS office (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    this.store = {
      read: () => this.readState(),
      transact: fn => ctx.storage.transactionSync(() => {
        const state = this.readState();
        const result = fn(state);
        if (!result.duplicate) this.sql.exec('INSERT INTO office(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(state));
        return result;
      })
    };
  }
  readState() {
    const rows = [...this.sql.exec('SELECT value FROM office WHERE id=1')];
    return rows.length ? JSON.parse(rows[0].value) : initialState();
  }
  fetch(request) { return handle(request, this.env, this.store, roster); }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!['/state', '/report'].includes(path)) return json({error: 'not_found'}, 404);
    // Object identity is deployment configuration, never a URL/user-provided path.
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(env.OFFICE_ID ?? '')) return json({error: 'invalid_office_id'}, 503);
    return env.OFFICE.get(env.OFFICE.idFromName(env.OFFICE_ID)).fetch(request);
  }
};
