import { useEffect, useState } from "react";
import { create } from "zustand";

export type ReplyState = { at: number };
export type FailureState = { at: number; errorClass: string | null };
export type RoomStatuses = {
  replies: Record<string, ReplyState>;
  failures: Record<string, FailureState>;
  typing: Record<string, number>;
};

export const REPLY_STALE_MS = 300_000;
export const FAILURE_SHOW_MS = 8_000;
export const TYPING_TTL_MS = 4_000;

type StatusFrame = { member_id: string; body: string; error_class?: string };

type StatusStore = {
  rooms: Record<string, RoomStatuses>;
  apply: (roomId: string, frame: StatusFrame, now: number) => void;
  onMessage: (roomId: string, senderId: string) => void;
  clearRoom: (roomId: string) => void;
};

function empty(): RoomStatuses {
  return { replies: {}, failures: {}, typing: {} };
}

function edit(rooms: Record<string, RoomStatuses>, roomId: string, change: (room: RoomStatuses) => void): Record<string, RoomStatuses> {
  const room: RoomStatuses = {
    replies: { ...(rooms[roomId]?.replies ?? {}) },
    failures: { ...(rooms[roomId]?.failures ?? {}) },
    typing: { ...(rooms[roomId]?.typing ?? {}) },
  };
  change(room);
  return { ...rooms, [roomId]: room };
}

export const useStatusStore = create<StatusStore>()((set) => ({
  rooms: {},
  apply(roomId, frame, now) {
    set((state) => ({
      rooms: edit(state.rooms, roomId, (room) => {
        const id = frame.member_id;
        if (frame.body === "is replying") {
          room.replies[id] = { at: now };
          delete room.failures[id];
          delete room.typing[id];
        } else if (frame.body === "reply failed") {
          delete room.replies[id];
          room.failures[id] = { at: now, errorClass: frame.error_class ?? null };
        } else if (frame.body === "reply ended") {
          delete room.replies[id];
        } else {
          room.typing[id] = now + TYPING_TTL_MS;
        }
      }),
    }));
  },
  onMessage(roomId, senderId) {
    set((state) => ({
      rooms: edit(state.rooms, roomId, (room) => {
        delete room.replies[senderId];
        delete room.typing[senderId];
      }),
    }));
  },
  clearRoom(roomId) {
    set((state) => ({ rooms: { ...state.rooms, [roomId]: empty() } }));
  },
}));

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
