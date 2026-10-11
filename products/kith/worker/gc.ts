/** Per-room trace GC. Seq holes are legal; kind=message is never deleted. */

export const GC_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const GC_MAX_ROWS = 50_000;

export type GcOptions = {
  maxAgeMs?: number;
  maxRows?: number;
  afterRoomId?: string;
  roomLimit?: number;
  rowLimit?: number;
  tracesBucket?: R2Bucket;
};

export type GcResult = {
  deleted: number;
  rooms: number;
  lastRoomId: string;
};

const DELETE_BATCH = 40;
export const GC_ROOMS_PER_RUN = 8;
// Covers eight days of the 128/day full-upload room quota when all 64 rooms are active.
// Summary-only trace traffic can still exceed cleanup throughput; monitor backlog and actual D1 usage.
export const GC_ROWS_PER_ROOM = 2048;

export async function gcTraces(db: D1Database, options: GcOptions = {}): Promise<GcResult> {
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? GC_MAX_AGE_MS);
  const maxRows = Math.min(GC_MAX_ROWS, Math.max(0, Math.trunc(options.maxRows ?? GC_MAX_ROWS)));
  const roomLimit = Math.min(GC_ROOMS_PER_RUN, Math.max(1, Math.trunc(options.roomLimit ?? GC_ROOMS_PER_RUN)));
  const rowLimit = Math.min(GC_ROWS_PER_ROOM, Math.max(1, Math.trunc(options.rowLimit ?? GC_ROWS_PER_ROOM)));
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

  const roomRows = await db
    .prepare(`SELECT id FROM rooms WHERE id > ? ORDER BY id LIMIT ?`)
    .bind(options.afterRoomId ?? "", roomLimit)
    .all<{ id: string }>();
  const roomIds = (roomRows.results ?? []).map((row) => row.id);

  let deleted = 0;
  let roomsTouched = 0;
  for (const roomId of roomIds) {
    const n = await gcRoom(db, roomId, cutoff, maxRows, rowLimit, options.tracesBucket);
    deleted += n;
    if (n > 0) roomsTouched += 1;
  }
  return { deleted, rooms: roomsTouched, lastRoomId: roomIds.at(-1) ?? "" };
}

export function gcAllRooms(db: D1Database): Promise<GcResult> {
  return gcTraces(db, { maxAgeMs: GC_MAX_AGE_MS, maxRows: GC_MAX_ROWS });
}

async function gcRoom(db: D1Database, roomId: string, cutoff: string, maxRows: number, rowLimit: number, bucket?: R2Bucket): Promise<number> {
  const traces = await db
    .prepare(
      `SELECT id, created_at FROM messages INDEXED BY messages_trace_gc WHERE room_id = ? AND kind = 'trace' AND (trace_full_state IS NULL OR trace_full_state IN ('stored', 'deleting')) ORDER BY created_at ASC, seq ASC LIMIT ?`,
    )
    .bind(roomId, rowLimit)
    .all<{ id: string; created_at: string }>();
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages WHERE room_id = ? LIMIT ?)`)
    .bind(roomId, maxRows + rowLimit)
    .first<{ n: number }>();
  let count = Number(countRow?.n ?? 0);
  const cap = Number.isFinite(maxRows) ? Math.max(0, maxRows) : 0;

  const toDelete: string[] = [];
  for (const row of traces.results ?? []) {
    const old = row.created_at < cutoff;
    if (count > cap || old) {
      toDelete.push(row.id);
      count -= 1;
    }
  }
  if (toDelete.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const chunk = toDelete.slice(i, i + DELETE_BATCH);
    const placeholders = chunk.map(() => "?").join(",");
    // Fence uploads before touching R2. A concurrent claim wins or loses this D1 transition;
    // it cannot put a new object after cleanup deletes the reference. Unknown claims stay quarantined.
    const fenced = await db
      .prepare(`UPDATE messages SET trace_full_state = 'deleting' WHERE kind = 'trace' AND id IN (${placeholders}) AND (trace_full_state IS NULL OR trace_full_state IN ('stored', 'deleting')) RETURNING id`)
      .bind(...chunk)
      .all<{ id: string }>();
    const ids = (fenced.results ?? []).map((row) => row.id);
    if (ids.length === 0) continue;
    // Failed R2 work retains a deleting reference for a later bounded run.
    if (bucket) await bucket.delete(ids.map((id) => `traces/${roomId}/${id}`));
    const deletePlaceholders = ids.map(() => "?").join(",");
    // kind='trace' is a hard guard: never delete kind=message.
    const result = await db
      .prepare(`DELETE FROM messages WHERE kind = 'trace' AND trace_full_state = 'deleting' AND id IN (${deletePlaceholders})`)
      .bind(...ids)
      .run();
    deleted += result.meta.changes;
  }
  return deleted;
}
