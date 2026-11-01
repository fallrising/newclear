// Typed wrappers around the Tauri IPC surface. The contract types are
// the generated TS bindings from `contracts/`. Anything that crosses the
// boundary uses them.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Event as LoomEvent } from "./contracts/Event";
import type { Origin } from "./contracts/Origin";
import type { PtyBatch } from "./contracts/PtyBatch";
import type { SessionId } from "./contracts/SessionId";
import type { SessionMeta } from "./contracts/SessionMeta";
import type { StreamId } from "./contracts/StreamId";

const USER: Origin = { kind: "user" };

export interface SpawnArgs {
  cwd: string;
  cmd?: string | null;
  shell?: string | null;
  cols?: number;
  rows?: number;
}

export async function spawnPty(args: SpawnArgs): Promise<SessionId> {
  return invoke<SessionId>("pty_spawn", {
    origin: USER,
    cwd: args.cwd,
    cmd: args.cmd ?? null,
    shell: args.shell ?? null,
    cols: args.cols ?? null,
    rows: args.rows ?? null,
  });
}

export async function killPty(sessionId: SessionId): Promise<void> {
  await invoke("pty_kill", { origin: USER, sessionId });
}

export async function resizePty(
  sessionId: SessionId,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("pty_resize", { origin: USER, sessionId, cols, rows });
}

// The terminal and document Run both submit through this boundary. Keep one
// native write in flight per session so separately scheduled IPC calls cannot
// reorder keystrokes or let a Run payload overtake them.
const stdinTails = new Map<SessionId, Promise<void>>();

export async function writeStdin(
  sessionId: SessionId,
  data: string,
): Promise<void> {
  const previous = stdinTails.get(sessionId);
  const submit = () => invoke<void>("pty_write_stdin", { origin: USER, sessionId, data });
  const current = previous ? previous.then(submit) : submit();
  const tail = current.then(
    () => { if (stdinTails.get(sessionId) === tail) stdinTails.delete(sessionId); },
    () => { if (stdinTails.get(sessionId) === tail) stdinTails.delete(sessionId); },
  );
  stdinTails.set(sessionId, tail);
  await current;
}

export async function subscribe(sessionId: SessionId): Promise<StreamId> {
  return invoke<StreamId>("pty_subscribe", { sessionId });
}

export async function detach(sessionId: SessionId): Promise<void> {
  await invoke("pty_detach", { sessionId });
}

export async function listSessions(): Promise<SessionId[]> {
  return invoke<SessionId[]>("pty_list_sessions");
}

export async function sessionMeta(
  sessionId: SessionId,
): Promise<SessionMeta | null> {
  return invoke<SessionMeta | null>("pty_session_meta", { sessionId });
}

// Runtime history DTOs are intentionally outside the frozen v1 contracts.
export interface SessionHistorySnapshot {
  sessions: SessionMeta[];
  live_session_ids: SessionId[];
  persistent: boolean;
  warning: string | null;
}

export function sessionHistory(): Promise<SessionHistorySnapshot> {
  return invoke<SessionHistorySnapshot>("session_history");
}

export function restartSession(sessionId: SessionId): Promise<SessionId> {
  return invoke<SessionId>("session_restart", { origin: USER, sessionId, cols: 120, rows: 30 });
}

export async function forgetSession(sessionId: SessionId): Promise<void> {
  await invoke("session_forget", { origin: USER, sessionId });
}

export function onSessionChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("session:changed", () => handler());
}

export async function ptyScrollback(
  sessionId: SessionId,
  maxChars?: number,
): Promise<string> {
  return invoke<string>("pty_scrollback", { sessionId, maxChars });
}

export async function homeDir(): Promise<string> {
  return invoke<string>("home_dir");
}

export function onPtyIo(
  handler: (batch: PtyBatch) => void,
): Promise<UnlistenFn> {
  return listen<PtyBatch>("pty:io", (event) => handler(event.payload));
}

export function onLoomEvent(
  handler: (ev: LoomEvent) => void,
): Promise<UnlistenFn> {
  return listen<LoomEvent>("loom:event", (event) => handler(event.payload));
}
