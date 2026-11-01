import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Native default close is already prevented, even before this listener exists. */
export function onWindowCloseRequested(callback: () => void): Promise<() => void> {
  return listen("loom:window-close-requested", callback);
}
export function approveWindowClose(): Promise<void> {
  return invoke("window_close_approved");
}
