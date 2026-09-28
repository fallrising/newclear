import type { Ack, NodeView, Sample, Telemetry } from '../../contracts/types.ts';
import { WORKSPACE } from '../../contracts/types.ts';
import { HttpError, sampleDigest } from '../../contracts/validation.ts';

// Minimal structural binding contract; Node adapter is a test double, not a D1 emulator.
export interface Result<T = Record<string, unknown>> { results?: T[]; meta?: {changes?: number} }
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<Result<T>>;
  run(): Promise<Result>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<Result[]> }
interface Row {id: string; workspace_id: string; display_name: string; generation: number; os: string; arch: string; agent_version: string; last_seen: string | null}
interface Saved {payload: string; received_at: string; request_id: string; digest: string}
function decode(row: Saved): Sample {
  return {...JSON.parse(row.payload), received_at: row.received_at, request_id: row.request_id} as Sample;
}
export class Store {
  db: Database;
  constructor(db: Database) {this.db = db;}
  async now(clock: () => number): Promise<number> {
    const row = await this.db.prepare('SELECT offset_seconds FROM demo_clock WHERE id=1').first<{offset_seconds: number}>();
    return clock() + (row?.offset_seconds ?? 0) * 1000;
  }
  async advance(seconds: number): Promise<void> {
    await this.db.prepare('UPDATE demo_clock SET offset_seconds=offset_seconds+? WHERE id=1').bind(seconds).run();
  }
  async reset(): Promise<void> {
    await this.db.batch([this.db.prepare('DELETE FROM samples'),this.db.prepare('DELETE FROM nodes'),this.db.prepare('UPDATE demo_clock SET offset_seconds=0 WHERE id=1')]);
  }
  async enroll(id: string, name: string): Promise<void> {
    await this.db.prepare('INSERT INTO nodes(id,workspace_id,display_name,generation,os,arch,agent_version,last_seen) VALUES(?,?,?,1,?,?,?,NULL) ON CONFLICT(id) DO NOTHING')
      .bind(id,WORKSPACE,name,'Linux (synthetic)','amd64','mock-agent/0.1').run();
  }
  async row(id: string, workspace = WORKSPACE as string): Promise<Row> {
    const r = await this.db.prepare('SELECT * FROM nodes WHERE id=? AND workspace_id=?').bind(id,workspace).first<Row>();
    if (!r) throw new HttpError(404,'node_not_found','Node not found in this workspace');
    return r;
  }
  async ingest(t: Telemetry, requestId: string, now: number): Promise<Ack> {
    await this.row(t.node_id);
    const digest = await sampleDigest(t), at = new Date(now).toISOString();
    const key = [t.node_id,t.enrollment_generation,t.boot_id,t.seq];
    // The receipt ID makes the projection update conditional on this insertion winning.
    // Duplicate or conflicting deliveries do not refresh heartbeat or replace sample bytes.
    await this.db.batch([
      this.db.prepare('DELETE FROM samples WHERE node_id=? AND observed_at < ?').bind(t.node_id,new Date(now-7*86400_000).toISOString()),
      this.db.prepare('INSERT INTO samples(node_id,generation,boot_id,seq,observed_at,received_at,request_id,digest,payload) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM samples WHERE node_id=?) < 4096 ON CONFLICT(node_id,generation,boot_id,seq) DO NOTHING')
        .bind(...key,t.observed_at,at,requestId,digest,JSON.stringify(t),t.node_id),
      this.db.prepare('UPDATE nodes SET last_seen=? WHERE id=? AND EXISTS(SELECT 1 FROM samples WHERE node_id=? AND generation=? AND boot_id=? AND seq=? AND request_id=?)')
        .bind(at,t.node_id,...key,requestId),
    ]);
    const saved = await this.db.prepare('SELECT * FROM samples WHERE node_id=? AND generation=? AND boot_id=? AND seq=?').bind(...key).first<Saved>();
    if (!saved) throw new HttpError(429,'demo_capacity','Demo limit of 4096 retained samples per node reached; no receipt issued');
    if (saved.digest !== digest) throw new HttpError(409,'sample_conflict','This sample identity already has different content');
    return {accepted:true, duplicate:saved.request_id !== requestId, seq:t.seq, received_at:saved.received_at, persisted_request_id:saved.request_id};
  }
  async view(row: Row, now: number): Promise<NodeView> {
    const latestRow = await this.db.prepare('SELECT * FROM samples WHERE node_id=? ORDER BY observed_at DESC, seq DESC LIMIT 1').bind(row.id).first<Saved>();
    const count = await this.db.prepare('SELECT count(*) AS n FROM samples WHERE node_id=?').bind(row.id).first<{n:number}>();
    const latest = latestRow ? decode(latestRow) : null;
    const age = row.last_seen === null ? Infinity : Math.max(0,now-Date.parse(row.last_seen));
    const connectivity = row.last_seen === null ? 'never-seen' : age > 210_000 ? 'offline' : age > 90_000 ? 'stale' : 'online';
    const data_fresh = !!latest && now-Date.parse(latest.observed_at) <= 90_000 && connectivity === 'online';
    const m = latest?.metrics;
    const memoryPercent = m?.memory_total_bytes ? Number(BigInt(m.memory_used_bytes!) * 10000n / BigInt(m.memory_total_bytes))/100 : null;
    const values = [m?.cpu_avg_percent,memoryPercent,m?.disk_used_percent].filter((x): x is number => typeof x === 'number');
    const health = !data_fresh || values.length === 0 ? 'unknown' : values.some(x=>x>=80) ? 'warning' : 'healthy';
    return {id:row.id,display_name:row.display_name,workspace_id:row.workspace_id,enrollment_generation:row.generation,
      os:row.os,arch:row.arch,agent_version:row.agent_version,host_authority:'none',mode:'monitor-only',
      connectivity,health,data_fresh,last_seen_received_at:row.last_seen,latest,sample_count:count?.n ?? 0};
  }
  async list(now: number, workspace = WORKSPACE as string): Promise<NodeView[]> {
    const rows = await this.db.prepare('SELECT * FROM nodes WHERE workspace_id=? ORDER BY id LIMIT 10').bind(workspace).all<Row>();
    return Promise.all((rows.results ?? []).map(r=>this.view(r,now)));
  }
  async history(id: string, from: string, to: string, limit: number): Promise<{samples: Sample[]; truncated: boolean}> {
    const r = await this.db.prepare('SELECT * FROM samples WHERE node_id=? AND observed_at>=? AND observed_at<=? ORDER BY observed_at DESC,seq DESC LIMIT ?').bind(id,from,to,limit+1).all<Saved>();
    const rows = r.results ?? [];
    return {samples:rows.slice(0,limit).reverse().map(decode), truncated:rows.length>limit};
  }
}
