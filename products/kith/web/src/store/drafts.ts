import { create } from "zustand";

export type Draft = { generationId: string; text: string; at: number };

const DONE_MAX = 50;

type DraftFrame = { member_id: string; generation_id: string; text: string };

type DraftState = {
  byRoom: Record<string, Record<string, Draft>>;
  done: Record<string, string[]>;
  apply(roomId: string, frame: DraftFrame): void;
  complete(roomId: string, generationId: string): void;
  clearMember(roomId: string, memberId: string): void;
  clearRoom(roomId: string): void;
};

export const useDraftStore = create<DraftState>()((set) => ({
  byRoom: {},
  done: {},
  apply(roomId, frame) {
    set((state) => {
      if ((state.done[roomId] ?? []).includes(frame.generation_id)) return state;
      const room = { ...(state.byRoom[roomId] ?? {}) };
      room[frame.member_id] = { generationId: frame.generation_id, text: frame.text, at: Date.now() };
      return { byRoom: { ...state.byRoom, [roomId]: room } };
    });
  },
  complete(roomId, generationId) {
    set((state) => {
      const next = [...(state.done[roomId] ?? []).filter((id) => id !== generationId), generationId];
      const room = { ...(state.byRoom[roomId] ?? {}) };
      for (const [memberId, draft] of Object.entries(room)) {
        if (draft.generationId === generationId) delete room[memberId];
      }
      return {
        done: { ...state.done, [roomId]: next.length > DONE_MAX ? next.slice(next.length - DONE_MAX) : next },
        byRoom: { ...state.byRoom, [roomId]: room },
      };
    });
  },
  clearMember(roomId, memberId) {
    set((state) => {
      const room = { ...(state.byRoom[roomId] ?? {}) };
      if (room[memberId] === undefined) return state;
      delete room[memberId];
      return { byRoom: { ...state.byRoom, [roomId]: room } };
    });
  },
  clearRoom(roomId) {
    set((state) => {
      if (state.byRoom[roomId] === undefined) return state;
      const byRoom = { ...state.byRoom };
      delete byRoom[roomId];
      return { byRoom };
    });
  },
}));
