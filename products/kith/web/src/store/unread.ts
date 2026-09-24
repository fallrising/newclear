import { create } from "zustand";
import type { RoomSummary } from "../api/types";

const PREFIX = "kith.unread.";

export function readCursor(roomId: string): number | null {
  try {
    const raw = localStorage.getItem(PREFIX + roomId);
    if (raw === null || !/^-?\d+$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

export function writeCursor(roomId: string, seq: number): void {
  try {
    const prev = readCursor(roomId);
    if (prev !== null && seq <= prev) return;
    localStorage.setItem(PREFIX + roomId, String(seq));
  } catch {
    // localStorage unavailable: the Zustand value still updates.
  }
}

type UnreadState = {
  cursors: Record<string, number>;
  bump: (roomId: string, seq: number) => void;
};

export const useUnreadStore = create<UnreadState>()((set, get) => ({
  cursors: {},
  bump(roomId, seq) {
    writeCursor(roomId, seq);
    const prev = get().cursors[roomId];
    const next = prev === undefined ? seq : Math.max(prev, seq);
    if (prev === next) return;
    set({ cursors: { ...get().cursors, [roomId]: next } });
  },
}));

export function initCursors(rooms: RoomSummary[]): void {
  for (const room of rooms) {
    const existing = readCursor(room.id);
    if (existing === null) useUnreadStore.getState().bump(room.id, room.last_seq ?? -1);
    else useUnreadStore.getState().bump(room.id, existing);
  }
}

export function clearUnread(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // nothing persisted
  }
  useUnreadStore.setState({ cursors: {} });
}
