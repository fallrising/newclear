import { create } from "zustand";
import type { ServerMessage } from "../api/types";
import { ROOM_CACHE_LIMIT, type PendingSend, type RoomTimeline } from "../sync/types";

type TimelineStore = {
  timelines: Record<string, RoomTimeline>;
  ensure(roomId: string): void;
  patch(roomId: string, partial: Partial<Omit<RoomTimeline, "rows" | "seqs" | "pending">>): void;
  mergeRows(roomId: string, rows: ServerMessage[]): void;
  clearRows(roomId: string): void;
  upsertPending(roomId: string, p: PendingSend): void;
  removePending(roomId: string, clientMessageId: string): void;
};

let openCounter = 0;

function empty(roomId: string): RoomTimeline {
  return {
    roomId,
    rows: {},
    seqs: [],
    pending: [],
    maxSeq: -1,
    contiguousHigh: -1,
    oldestLoaded: null,
    hasMoreOlder: false,
    loadingOlder: false,
    olderFailed: false,
    phase: "loading_latest",
    jumped: false,
    badFrames: 0,
    lastOpenedAt: 0,
  };
}

export const useTimelineStore = create<TimelineStore>()((set, get) => ({
  timelines: {},

  ensure(roomId) {
    const timelines = { ...get().timelines };
    timelines[roomId] = { ...(timelines[roomId] ?? empty(roomId)), lastOpenedAt: ++openCounter };
    const ids = Object.keys(timelines);
    if (ids.length > ROOM_CACHE_LIMIT) {
      const oldest = ids
        .filter((id) => id !== roomId)
        .sort((a, b) => timelines[a]!.lastOpenedAt - timelines[b]!.lastOpenedAt)[0];
      if (oldest !== undefined) delete timelines[oldest];
    }
    set({ timelines });
  },

  patch(roomId, partial) {
    const t = get().timelines[roomId];
    if (!t) return;
    set({ timelines: { ...get().timelines, [roomId]: { ...t, ...partial } } });
  },

  mergeRows(roomId, rows) {
    const t = get().timelines[roomId];
    if (!t) return;
    let next: Record<number, ServerMessage> | null = null;
    for (const row of rows) {
      if (t.rows[row.seq]?.id === row.id) continue;
      next ??= { ...t.rows };
      next[row.seq] = row;
    }
    if (next === null) return; // nothing new: no re-render (FM-SYNC-05)
    const seqs = Object.keys(next)
      .map(Number)
      .sort((a, b) => a - b);
    set({
      timelines: {
        ...get().timelines,
        [roomId]: { ...t, rows: next, seqs, maxSeq: seqs.length > 0 ? seqs[seqs.length - 1]! : -1 },
      },
    });
  },

  clearRows(roomId) {
    const t = get().timelines[roomId];
    if (!t) return;
    set({
      timelines: {
        ...get().timelines,
        [roomId]: { ...t, rows: {}, seqs: [], maxSeq: -1, contiguousHigh: -1, oldestLoaded: null, hasMoreOlder: false },
      },
    });
  },

  upsertPending(roomId, p) {
    const t = get().timelines[roomId];
    if (!t) return;
    const pending = [...t.pending.filter((x) => x.clientMessageId !== p.clientMessageId), p].sort((a, b) => a.order - b.order);
    set({ timelines: { ...get().timelines, [roomId]: { ...t, pending } } });
  },

  removePending(roomId, clientMessageId) {
    const t = get().timelines[roomId];
    if (!t || !t.pending.some((x) => x.clientMessageId === clientMessageId)) return;
    const pending = t.pending.filter((x) => x.clientMessageId !== clientMessageId);
    set({ timelines: { ...get().timelines, [roomId]: { ...t, pending } } });
  },
}));

export function useRoomTimeline(roomId: string): RoomTimeline | undefined {
  return useTimelineStore((s) => s.timelines[roomId]);
}
