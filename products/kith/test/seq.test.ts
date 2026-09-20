import { describe, expect, it } from "vitest";
import {
  broadcastThenPersist,
  createSeqStore,
  d1MaxSeq,
  deleteSeq,
  persistThenBroadcast,
  recoverNextSeq,
  type SeqRow,
} from "../src/seq.ts";

function row(seq: number, kind: SeqRow["kind"] = "message", client = `c${seq}`): SeqRow {
  return {
    room_id: "r1",
    seq,
    kind,
    sender_id: "human-1",
    client_message_id: client,
    body: `body-${seq}`,
  };
}

describe("D1 seq recovery", () => {
  it("ST-D1-01: INSERT seq 0,1 then crash before persist next_seq/broadcast; restart MAX+1 is 2", () => {
    const store = createSeqStore();
    persistThenBroadcast(store, row(0));
    expect(store.nextSeqCache).toBe(1);

    persistThenBroadcast(store, row(1), { crashBefore: "persist_next_seq" });
    expect(store.rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(store.nextSeqCache).toBe(1);
    expect(store.eventsEmitted.map((r) => r.seq)).toEqual([0]);

    const recovered = recoverNextSeq(d1MaxSeq(store));
    expect(recovered).toBe(2);
    expect(recovered).not.toBe(0);
    expect(recovered).not.toBe(1);
  });

  it("ST-D1-02: unknown insert timeout does not broadcast; UNIQUE hit returns original row", () => {
    const store = createSeqStore();
    const first = persistThenBroadcast(store, row(0, "message", "01JTESTCLIENTMSG01"), {
      insertOutcome: "timeout_unknown",
    });
    expect(first).toEqual({ ok: false, code: "timeout_unknown", broadcast: false });
    expect(store.eventsEmitted).toHaveLength(0);
    expect(store.nextSeqCache).toBeNull();
    expect(store.rows).toHaveLength(1);

    const retry = persistThenBroadcast(store, row(99, "message", "01JTESTCLIENTMSG01"));
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("expected unique hit");
    expect(retry.uniqueHit).toBe(true);
    if (!retry.uniqueHit) throw new Error("expected uniqueHit");
    expect(retry.assignedNewSeq).toBe(false);
    expect(retry.row.seq).toBe(0);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.seq).toBe(0);
    expect(store.eventsEmitted).toHaveLength(0);
  });

  it("ST-D1-03: broadcast-before-INSERT helper is rejected; events_emitted=0", () => {
    const store = createSeqStore();
    expect(() => broadcastThenPersist(store, row(0))).toThrow(/broadcast only after INSERT/);
    expect(store.eventsEmitted).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  it("ST-D1-04: GC hole uses MAX not COUNT; seq 0,1,2 delete 1 → COUNT=2 next=3", () => {
    const store = createSeqStore();
    persistThenBroadcast(store, row(0, "message"));
    persistThenBroadcast(store, row(1, "trace"));
    persistThenBroadcast(store, row(2, "message"));
    deleteSeq(store, 1);

    const count = store.rows.length;
    const max = d1MaxSeq(store);
    expect(count).toBe(2);
    expect(max).toBe(2);
    expect(recoverNextSeq(max)).toBe(3);
    expect(recoverNextSeq(max)).not.toBe(count);
  });

  it("ST-D1-04: two GC holes leave COUNT != MAX so next is MAX+1 not COUNT+1", () => {
    const store = createSeqStore();
    persistThenBroadcast(store, row(0, "message"));
    persistThenBroadcast(store, row(1, "trace"));
    persistThenBroadcast(store, row(2, "trace"));
    persistThenBroadcast(store, row(3, "message"));
    deleteSeq(store, 1);
    deleteSeq(store, 2);

    const count = store.rows.length;
    const max = d1MaxSeq(store);
    expect(count).toBe(2);
    expect(max).toBe(3);
    expect(recoverNextSeq(max)).toBe(4);
    expect(recoverNextSeq(max)).not.toBe(count + 1);
    const allocated: SeqRow = { ...row(recoverNextSeq(max), "message", "after-gc"), seq: recoverNextSeq(max) };
    const sent = persistThenBroadcast(store, allocated);
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error("expected insert");
    expect(sent.row.seq).toBe(4);
  });
});
