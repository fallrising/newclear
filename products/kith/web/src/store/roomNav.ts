import { create } from "zustand";

export const useRoomNav = create<{
  order: string[];
  unread: string[];
  set: (order: string[], unread: string[]) => void;
}>()((set) => ({
  order: [],
  unread: [],
  set: (order, unread) => set({ order, unread }),
}));
