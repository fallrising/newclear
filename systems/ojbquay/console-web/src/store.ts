import {create} from "zustand";

interface UiState {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (collapsed) => set({collapsed}),
}));
