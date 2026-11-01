import type { Node } from "@xyflow/react";
import type { SessionMeta } from "../../contracts/SessionMeta";
import { NODE_SIZE } from "./config";

interface SavedCommand { cwd: string; cmd: string | null; shell: string; name: string | null }
interface RecoveryHooks {
  kill(id: string): void;
  close(sessionId: string, nodeId: string): void;
  rename(nodeId: string, name: string | null): void;
  restart(nodeId: string, was: SavedCommand): void;
  dismiss(nodeId: string): void;
}

export function withObservedExit(meta: SessionMeta, exits: ReadonlyMap<string, number | null>): SessionMeta {
  return exits.has(meta.id) ? { ...meta, state: { kind: "exited", code: exits.get(meta.id) ?? null } } : meta;
}

export interface AttachmentOptions { position?: { x: number; y: number }; replaceNodeId?: string; name?: string | null }

export function appendHistoryNode(nodes: Node[], meta: SessionMeta, position: { x: number; y: number }, hooks: RecoveryHooks, options: AttachmentOptions = {}): Node[] {
  const id = `t-${meta.id}`;
  if (nodes.some((node) => node.id === id)) return nodes;
  const replaced = options.replaceNodeId ? nodes.find((node) => node.id === options.replaceNodeId) : undefined;
  if (options.replaceNodeId && !replaced) return nodes;
  const was: SavedCommand = { cwd: meta.cwd, cmd: meta.cmd, shell: meta.shell, name: options.name ?? null };
  const ended = meta.state.kind === "exited" || meta.state.kind === "tombstone";
  const reason = meta.state.kind === "tombstone" ? meta.state.reason : meta.state.kind === "exited" && meta.state.code !== null && meta.state.code !== 0 ? `exited with code ${meta.state.code}` : "exited";
  const node: Node = {
    position, style: NODE_SIZE.terminal, ...replaced,
    id, type: ended ? "tombstone" : "terminal",
    data: ended ? {
      sidecarGroup: replaced?.data.sidecarGroup,
      reason, was: { ...was, type: "terminal" }, exitCode: meta.state.kind === "exited" ? meta.state.code : undefined,
      onRestart: () => hooks.restart(id, was), onDismiss: () => hooks.dismiss(id),
    } : {
      sidecarGroup: replaced?.data.sidecarGroup,
      ...was, sessionId: meta.id,
      onKill: () => hooks.kill(meta.id), onClose: () => hooks.close(meta.id, id), onRename: (name: string | null) => hooks.rename(id, name),
    },
  };
  return replaced ? nodes.map((previous) => previous.id === replaced.id ? node : previous) : [...nodes, node];
}
