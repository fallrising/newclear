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

export async function writeStdin(
  sessionId: SessionId,
  data: string,
): Promise<void> {
  await invoke("pty_write_stdin", { origin: USER, sessionId, data });
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
