/** Per-room trace GC. Seq holes are legal; kind=message is never deleted. */

export const GC_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const GC_MAX_ROWS = 50_000;

export type GcOptions = {
  maxAgeMs?: number;
  maxRows?: number;
};

export type GcResult = {
  deleted: number;
  rooms: number;
};

const DELETE_BATCH = 40;

export async function gcTraces(db: D1Database, options: GcOptions = {}): Promise<GcResult> {
  const maxAgeMs = options.maxAgeMs ?? GC_MAX_AGE_MS;
  const maxRows = options.maxRows ?? GC_MAX_ROWS;
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

  const roomRows = await db
    .prepare(`SELECT DISTINCT room_id AS id FROM messages WHERE kind IN ('message', 'trace')`)
    .all<{ id: string }>();
  const roomIds = (roomRows.results ?? []).map((row) => row.id);

  let deleted = 0;
  let roomsTouched = 0;
  for (const roomId of roomIds) {
    const n = await gcRoom(db, roomId, cutoff, maxRows);
    deleted += n;
    if (n > 0) roomsTouched += 1;
  }
  return { deleted, rooms: roomsTouched };
}

export function gcAllRooms(db: D1Database): Promise<GcResult> {
  return gcTraces(db, { maxAgeMs: GC_MAX_AGE_MS, maxRows: GC_MAX_ROWS });
}

async function gcRoom(db: D1Database, roomId: string, cutoff: string, maxRows: number): Promise<number> {
  const traces = await db
    .prepare(
      `SELECT id, created_at FROM messages WHERE room_id = ? AND kind = 'trace' ORDER BY seq ASC`,
    )
    .bind(roomId)
    .all<{ id: string; created_at: string }>();
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ? AND kind IN ('message', 'trace')`)
    .bind(roomId)
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

  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const chunk = toDelete.slice(i, i + DELETE_BATCH);
    const placeholders = chunk.map(() => "?").join(",");
    // kind='trace' is a hard guard: never delete kind=message.
    await db
      .prepare(`DELETE FROM messages WHERE kind = 'trace' AND id IN (${placeholders})`)
      .bind(...chunk)
      .run();
  }
  return toDelete.length;
}
