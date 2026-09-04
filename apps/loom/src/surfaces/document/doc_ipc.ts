// Typed wrappers around the doc_* Tauri commands. Stays in
// surfaces/document so the rest of the app can import from src/ipc.ts
// without dragging in doc-specific surfaces.

import { invoke } from "@tauri-apps/api/core";

import type { Origin } from "../../contracts/Origin";

const USER: Origin = { kind: "user" };

export interface DocSnapshot {
  content: string;
  on_disk_hash: string;
}

export type WriteOutcome =
  | { kind: "written"; new_hash: string }
  | { kind: "conflict"; current_disk_hash: string };

export type ConflictStatus = "unknown" | "no_conflict" | "conflict";

export async function vaultRoot(): Promise<string> {
  return invoke<string>("vault_root");
}

export async function docRead(path: string): Promise<DocSnapshot> {
  return invoke<DocSnapshot>("doc_read", { path });
}

export async function docWrite(
  path: string,
  content: string,
  expectedHash: string | null,
): Promise<WriteOutcome> {
  return invoke<WriteOutcome>("doc_write", {
    origin: USER,
    path,
    content,
    expectedHash,
  });
}

export async function docOpen(
  path: string,
  onDiskHash: string,
): Promise<void> {
  await invoke("doc_open", { path, onDiskHash });
}

export async function docClose(path: string): Promise<void> {
  await invoke("doc_close", { path });
}

export async function docMarkDirty(path: string): Promise<void> {
  await invoke("doc_mark_dirty", { path });
}

export async function docMarkClean(path: string): Promise<void> {
  await invoke("doc_mark_clean", { path });
}

export async function docCheckConflict(path: string): Promise<ConflictStatus> {
  return invoke<ConflictStatus>("doc_check_conflict", { path });
}
