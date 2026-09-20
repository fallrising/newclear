export type MessageKind = "message" | "trace";

export type SeqRow = {
  room_id: string;
  seq: number;
  kind: MessageKind;
  sender_id: string;
  client_message_id: string;
  body?: string;
};

export type SeqStore = {
  rows: SeqRow[];
  nextSeqCache: number | null;
  eventsEmitted: SeqRow[];
};

export type InsertOutcome = "ok" | "timeout_unknown" | "fail";

export type PersistOptions = {
  crashBefore?: "persist_next_seq" | "broadcast";
  insertOutcome?: InsertOutcome;
};

export type PersistResult =
  | { ok: true; row: SeqRow; uniqueHit: false }
  | { ok: true; row: SeqRow; uniqueHit: true; assignedNewSeq: false }
  | { ok: false; code: "timeout_unknown" | "insert_failed" | "crashed"; broadcast: false };

export function createSeqStore(): SeqStore {
  return { rows: [], nextSeqCache: null, eventsEmitted: [] };
}

/** next_seq = COALESCE(MAX(seq), -1) + 1. Never COUNT. */
export function recoverNextSeq(d1MaxSeq: number | null): number {
  return (d1MaxSeq ?? -1) + 1;
}

export function d1MaxSeq(store: SeqStore): number | null {
  if (store.rows.length === 0) return null;
  let max = store.rows[0]!.seq;
  for (const row of store.rows) {
    if (row.seq > max) max = row.seq;
  }
  return max;
}

export function deleteSeq(store: SeqStore, seq: number): void {
  store.rows = store.rows.filter((row) => row.seq !== seq);
}

function findByClientId(store: SeqStore, row: SeqRow): SeqRow | undefined {
  return store.rows.find(
    (existing) =>
      existing.room_id === row.room_id &&
      existing.sender_id === row.sender_id &&
      existing.client_message_id === row.client_message_id,
  );
}

function insertRow(store: SeqStore, row: SeqRow, outcome: InsertOutcome): PersistResult {
  const original = findByClientId(store, row);
  if (original) {
    return { ok: true, row: original, uniqueHit: true, assignedNewSeq: false };
  }
  if (store.rows.some((existing) => existing.room_id === row.room_id && existing.seq === row.seq)) {
    return { ok: false, code: "insert_failed", broadcast: false };
  }
  if (outcome === "fail") {
    return { ok: false, code: "insert_failed", broadcast: false };
  }
  const stored: SeqRow = { ...row };
  store.rows.push(stored);
  if (outcome === "timeout_unknown") {
    return { ok: false, code: "timeout_unknown", broadcast: false };
  }
  return { ok: true, row: stored, uniqueHit: false };
}

/** INSERT first; on success persist next_seq then broadcast. Insert failure does not broadcast. */
export function persistThenBroadcast(store: SeqStore, row: SeqRow, options: PersistOptions = {}): PersistResult {
  const inserted = insertRow(store, row, options.insertOutcome ?? "ok");
  if (!inserted.ok || inserted.uniqueHit) {
    return inserted;
  }
  if (options.crashBefore === "persist_next_seq") {
    return { ok: false, code: "crashed", broadcast: false };
  }
  store.nextSeqCache = row.seq + 1;
  if (options.crashBefore === "broadcast") {
    return { ok: false, code: "crashed", broadcast: false };
  }
  store.eventsEmitted.push(inserted.row);
  return inserted;
}

/** There is no API that broadcasts before INSERT. Calling this helper is rejected. */
export function broadcastThenPersist(_store: SeqStore, _row: SeqRow): never {
  throw new Error("broadcast only after INSERT success");
}
