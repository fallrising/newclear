import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { gcTraces } from "../../worker/gc.ts";
import type { Room } from "../../worker/room.ts";

const old = "2020-01-01T00:00:00Z";
beforeEach(async () => {
  await env.DB.batch(["agent_runtime_changes", "agent_runtimes", "provider_connections", "messages", "bot_tokens", "generations", "room_members", "rooms", "members"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.prepare(`INSERT INTO members(id,kind,handle,display_name,password_hash,created_at) VALUES('cost-agent','agent','cost-agent','Agent',NULL,?)`).bind(old).run();
});
async function room(id: string) { await env.DB.prepare(`INSERT INTO rooms(id,slug,name,created_by,created_at) VALUES(?,?,?,'cost-agent',?)`).bind(id,id,id,old).run(); }
async function traces(id: string, count: number, offset = 0) {
  const rows = Array.from({ length: count }, (_, i) => env.DB.prepare(`INSERT INTO messages(id,room_id,seq,kind,sender_id,body,client_message_id,created_at) VALUES(?,?,?,'trace','cost-agent','summary',?,?)`)
    .bind(`${id}-${i+offset}`, id, i+offset, `client-${i+offset}`, old));
  for (let n=0; n<rows.length; n+=40) await env.DB.batch(rows.slice(n,n+40));
}
async function remaining(id: string) { return (await env.DB.prepare(`SELECT COUNT(*) n FROM messages WHERE room_id=?`).bind(id).first<{n:number}>())!.n; }

describe("bounded trace storage and cleanup", () => {
  it("limits rows per room, advances across rooms, and uses indexed query plans", async () => {
    for (let i=0;i<10;i++) { const id=`room-${i}`; await room(id); await traces(id,3); }
    const first=await gcTraces(env.DB,{roomLimit:8,rowLimit:2,maxRows:0});
    expect(first.deleted).toBe(16);
    expect(first.lastRoomId).toBe("room-7");
    expect(await remaining("room-0")).toBe(1);
    expect(await remaining("room-8")).toBe(3);
    const second=await gcTraces(env.DB,{afterRoomId:first.lastRoomId,rowLimit:2,maxRows:0});
    expect(second.deleted).toBe(4);
    const end=await gcTraces(env.DB,{afterRoomId:second.lastRoomId});
    expect(end.lastRoomId).toBe("");
    const plan=await env.DB.prepare(`EXPLAIN QUERY PLAN SELECT id,created_at FROM messages INDEXED BY messages_trace_gc WHERE room_id=? AND kind='trace' AND (trace_full_state IS NULL OR trace_full_state IN ('stored','deleting')) ORDER BY created_at,seq LIMIT 200`).bind("room-0").all<{detail:string}>();
    expect(plan.results.some((p)=>p.detail.includes("messages_trace_gc"))).toBe(true);
    expect(plan.results.some((p)=>p.detail.includes("TEMP B-TREE"))).toBe(false);
  });
  it("R2 cleanup occurs before D1 reference deletion; failed cleanup retains rows", async () => {
    await room("cleanup"); await traces("cleanup",3);
    const removed:string[]=[];
    const bucket={ delete: async(keys:string[])=>{ expect(await remaining("cleanup")).toBe(3); removed.push(...keys); } } as unknown as R2Bucket;
    expect((await gcTraces(env.DB,{maxRows:0,tracesBucket:bucket})).deleted).toBe(3);
    expect(removed).toEqual(["traces/cleanup/cleanup-0","traces/cleanup/cleanup-1","traces/cleanup/cleanup-2"]);
    await traces("cleanup",1,10);
    await expect(gcTraces(env.DB,{maxRows:0,tracesBucket:{delete:async()=>{throw new Error("fake failure");}} as unknown as R2Bucket})).rejects.toThrow("fake failure");
    expect(await remaining("cleanup")).toBe(1);
  });
  it("concurrent duplicate uploads claim one R2 operation and keep unknown results fenced", async () => {
    await room("uploads"); await traces("uploads",1);
    const stub=env.ROOM.get(env.ROOM.idFromName(`trace-test:${crypto.randomUUID()}`)) as unknown as Room;
    const results=await Promise.all(Array.from({length:20},()=>stub.claimTraceUpload("uploads","uploads-0","cost-agent")));
    expect(results.filter((r)=>r.ok)).toHaveLength(1);
    expect(await stub.claimTraceUpload("uploads","uploads-0","cost-agent")).toEqual({ok:false,stored:false});
    await stub.completeTraceUpload("uploads-0");
    expect(await stub.claimTraceUpload("uploads","uploads-0","cost-agent")).toEqual({ok:false,stored:true});
  });
  it("per-agent daily upload quota refuses the 33rd distinct full text", async () => {
    await room("quota"); await traces("quota",33);
    const stub=env.ROOM.get(env.ROOM.idFromName(`trace-test:${crypto.randomUUID()}`)) as unknown as Room;
    for(let i=0;i<32;i++) expect((await stub.claimTraceUpload("quota",`quota-${i}`,"cost-agent")).ok).toBe(true);
    expect((await stub.claimTraceUpload("quota","quota-32","cost-agent")).ok).toBe(false);
  });
  it("fences a concurrent late upload before R2 cleanup and retries failed deletion", async () => {
    await room("race"); await traces("race",1);
    const stub=env.ROOM.get(env.ROOM.idFromName(`trace-test:${crypto.randomUUID()}`)) as unknown as Room;
    const bucket={delete:async()=>{
      expect(await stub.claimTraceUpload("race","race-0","cost-agent")).toEqual({ok:false,stored:false});
      expect(await stub.completeTraceUpload("race-0")).toBe(false);
      throw new Error("fake cleanup failure");
    }} as unknown as R2Bucket;
    await expect(gcTraces(env.DB,{maxRows:0,tracesBucket:bucket})).rejects.toThrow("fake cleanup failure");
    expect((await env.DB.prepare(`SELECT trace_full_state FROM messages WHERE id='race-0'`).first<{trace_full_state:string}>())?.trace_full_state).toBe("deleting");
    expect((await gcTraces(env.DB,{maxRows:0,tracesBucket:{delete:async()=>{}} as unknown as R2Bucket})).deleted).toBe(1);
  });
  it("quarantines unknown uploads while allowing indexed cleanup of later eligible rows", async () => {
    await room("quarantine"); await traces("quarantine",3);
    const stub=env.ROOM.get(env.ROOM.idFromName(`trace-test:${crypto.randomUUID()}`)) as unknown as Room;
    expect((await stub.claimTraceUpload("quarantine","quarantine-0","cost-agent")).ok).toBe(true);
    const removed:string[]=[];
    expect((await gcTraces(env.DB,{rowLimit:1,maxRows:0,tracesBucket:{delete:async(keys:string[])=>{removed.push(...keys);}} as unknown as R2Bucket})).deleted).toBe(1);
    expect(removed).toEqual(["traces/quarantine/quarantine-1"]);
    expect((await env.DB.prepare(`SELECT trace_full_state FROM messages WHERE id='quarantine-0'`).first<{trace_full_state:string}>())?.trace_full_state).toBe("claimed");
  });
});
