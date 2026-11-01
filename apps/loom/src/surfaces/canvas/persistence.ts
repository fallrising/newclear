// Canvas sidecar serialization. Reads / writes `<vault>/.loom/canvas.json`
// per the A0 contract in `schema/canvas-sidecar.md`.
//
// Runtime → on-disk transformations:
// - document nodes  → persisted as document with `path`.
// - terminal nodes  → persisted as **tombstone** (terminals carry an
//                     ephemeral session id, but their cwd/cmd/shell is
//                     what survives reboot). On load, every persisted
//                     terminal arrives as a tombstone the user can
//                     restart — same model as B1's session_store boot
//                     recovery (§7.1).
// - tombstone nodes → persisted as-is.
//
// The canvas state in memory uses react-flow shapes; this module maps
// to and from the sidecar shape and never leaks the on-disk schema into
// React state.

import { invoke } from "@tauri-apps/api/core";
import type { Edge, Node } from "@xyflow/react";

import type { EdgeKind } from "./edges";
import { edgeStyleFor } from "./edges";
import { NODE_SIZE } from "./config";

export const CANVAS_VERSION = 1;

interface SidecarPosition {
  x: number;
  y: number;
  w: number;
  h: number;
  group: string | null;
}

interface SidecarTombstoneWas {
  type: "terminal";
  cwd: string;
  cmd: string | null;
  shell: string;
  /// Optional user-given name carried through restart so doc frontmatter
  /// `run_in:` keeps resolving after the user kills and re-spawns.
  name?: string | null;
}

interface SidecarDocumentKind {
  type: "document";
  path: string;
}

interface SidecarTombstoneKind {
  type: "tombstone";
  reason: string;
  was: SidecarTombstoneWas;
}

type SidecarKind = SidecarDocumentKind | SidecarTombstoneKind;

interface SidecarNode extends SidecarPosition {
  id: string;
  kind: SidecarKind;
}

interface SidecarEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface CanvasSidecar {
  version: number;
  nodes: SidecarNode[];
  edges: SidecarEdge[];
}

// ── IPC ─────────────────────────────────────────────────────────────────

export async function readCanvasSidecar(): Promise<CanvasSidecar | null> {
  const raw = await invoke<string | null>("canvas_read");
  if (raw == null) return null;
  return validateCanvasSidecar(JSON.parse(raw));
}

// Unknown fields are legal extensions, but this renderer cannot round-trip
// them. Refuse to hydrate for editing instead of silently discarding data.
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid canvas ${label}: expected object`);
  }
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`Canvas read-only: unsupported ${label} fields; original file preserved`);
  }
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
export function validateCanvasSidecar(value: unknown): CanvasSidecar {
  const root = record(value, "root");
  if (root.version !== CANVAS_VERSION) throw new Error(`Unsupported canvas version ${String(root.version)}; original file preserved`);
  fields(root, ["version", "nodes", "edges"], "root");
  if (!Array.isArray(root.nodes) || !Array.isArray(root.edges)) throw new Error("Invalid canvas node/edge collections");
  const ids = new Set<string>();
  for (const item of root.nodes) {
    const n = record(item, "node");
    fields(n, ["id", "kind", "x", "y", "w", "h", "group"], "node");
    if (!text(n.id) || ids.has(n.id)) throw new Error("Invalid or duplicate canvas node id");
    ids.add(n.id);
    if (![n.x, n.y, n.w, n.h].every((v) => typeof v === "number" && Number.isFinite(v)) || Number(n.w) <= 0 || Number(n.h) <= 0 || !(n.group === null || typeof n.group === "string")) {
      throw new Error("Invalid canvas node position, dimensions or group");
    }
    const k = record(n.kind, "node kind");
    if (k.type === "document") {
      fields(k, ["type", "path"], "document");
      if (!text(k.path)) throw new Error("Invalid canvas document path");
    } else if (k.type === "tombstone") {
      fields(k, ["type", "reason", "was"], "tombstone");
      if (typeof k.reason !== "string") throw new Error("Invalid canvas tombstone reason");
      const was = record(k.was, "tombstone subject");
      if (was.type === "document") throw new Error("Canvas read-only: document tombstones unsupported; original file preserved");
      fields(was, ["type", "cwd", "cmd", "shell", "name"], "terminal tombstone");
      if (was.type !== "terminal" || !text(was.cwd) || !text(was.shell) || !(was.cmd === null || typeof was.cmd === "string") || !(was.name === undefined || was.name === null || typeof was.name === "string")) {
        throw new Error("Invalid canvas terminal tombstone");
      }
    } else if (k.type === "terminal") {
      throw new Error("Canvas read-only: live terminal restoration unsupported; original file preserved");
    } else throw new Error("Invalid canvas node kind");
  }
  const edgeIds = new Set<string>();
  for (const item of root.edges) {
    const e = record(item, "edge");
    fields(e, ["id", "from", "to", "kind"], "edge");
    if (!text(e.id) || edgeIds.has(e.id) || !text(e.from) || !ids.has(e.from) || !text(e.to) || !ids.has(e.to) || typeof e.kind !== "string" || !["triggers", "feeds_output_to", "context_for"].includes(e.kind)) {
      throw new Error("Invalid canvas edge shape or endpoint");
    }
    edgeIds.add(e.id);
  }
  return root as unknown as CanvasSidecar;
}

export async function writeCanvasSidecar(value: CanvasSidecar): Promise<void> {
  await invoke("canvas_write", { content: JSON.stringify(value, null, 2) });
}

// ── Runtime ↔ sidecar conversion ────────────────────────────────────────

interface TerminalDataLike {
  cwd?: string;
  cmd?: string | null;
  shell?: string;
  name?: string | null;
}

interface TombstoneDataLike {
  reason?: string;
  was?: SidecarTombstoneWas;
}

interface DocumentDataLike {
  path?: string;
}

/// Convert the live react-flow node array into the sidecar shape.
export function serializeNodes(nodes: Node[]): SidecarNode[] {
  const out: SidecarNode[] = [];
  for (const n of nodes) {
    const pos: SidecarPosition = {
      x: n.position.x,
      y: n.position.y,
      w: nodeWidth(n),
      h: nodeHeight(n),
      group: typeof n.data.sidecarGroup === "string" ? n.data.sidecarGroup : null,
    };
    if (n.type === "document") {
      const d = n.data as DocumentDataLike;
      if (!d.path) continue;
      out.push({ id: n.id, ...pos, kind: { type: "document", path: d.path } });
    } else if (n.type === "terminal") {
      const d = n.data as TerminalDataLike;
      if (!d.cwd || !d.shell) continue;
      // Terminal → tombstone for persistence. session_id is ephemeral
      // and worthless across restarts.
      out.push({
        id: n.id,
        ...pos,
        kind: {
          type: "tombstone",
          reason: "persisted across app restart",
          was: {
            type: "terminal",
            cwd: d.cwd,
            cmd: d.cmd ?? null,
            shell: d.shell,
            name: d.name ?? null,
          },
        },
      });
    } else if (n.type === "tombstone") {
      const d = n.data as TombstoneDataLike;
      if (typeof d.reason !== "string" || !d.was) continue;
      out.push({
        id: n.id,
        ...pos,
        kind: { type: "tombstone", reason: d.reason, was: { ...d.was, type: "terminal" } },
      });
    }
  }
  return out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function serializeEdges(edges: Edge[]): SidecarEdge[] {
  const out: SidecarEdge[] = [];
  for (const e of edges) {
    const d = e.data as
      | { kind?: EdgeKind; synthetic?: boolean }
      | undefined;
    // Synthetic edges are recomputed from `run_in:` frontmatter on every
    // load; persisting them would just duplicate the markdown's intent.
    if (d?.synthetic) continue;
    if (!d?.kind) continue;
    out.push({ id: e.id, from: e.source, to: e.target, kind: d.kind });
  }
  return out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/// Hydration helpers — these produce *partial* react-flow nodes and edges.
/// The CanvasSurface fills in the runtime-only fields (callbacks, etc.)
/// at mount time because they reference live closures.
interface HydratedLayout {
  width: number;
  height: number;
  group: string | null;
}
export interface HydratedTerminalSpec extends HydratedLayout {
  kind: "tombstone";
  id: string;
  position: { x: number; y: number };
  reason: string;
  was: SidecarTombstoneWas;
}

export interface HydratedDocumentSpec extends HydratedLayout {
  kind: "document";
  id: string;
  position: { x: number; y: number };
  path: string;
}

export type HydratedNodeSpec = HydratedTerminalSpec | HydratedDocumentSpec;

export interface HydratedEdgeSpec {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  sourceHandle: string;
  targetHandle: string;
}

export interface HydratedSidecar {
  nodes: HydratedNodeSpec[];
  edges: HydratedEdgeSpec[];
}

export function hydrate(sidecar: CanvasSidecar): HydratedSidecar {
  const nodes: HydratedNodeSpec[] = [];
  for (const n of sidecar.nodes) {
    const position = { x: n.x, y: n.y };
    const layout = { width: n.w, height: n.h, group: n.group };
    if (n.kind.type === "document") {
      nodes.push({ kind: "document", id: n.id, position, path: n.kind.path, ...layout });
    } else if (n.kind.type === "tombstone") {
      nodes.push({
        kind: "tombstone",
        id: n.id,
        position,
        ...layout,
        reason: n.kind.reason,
        was: n.kind.was,
      });
    }
  }
  const edges: HydratedEdgeSpec[] = sidecar.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    kind: e.kind,
    sourceHandle: e.kind === "context_for" && sidecar.nodes.find((n) => n.id === e.from)?.kind.type === "tombstone" ? "context-out" : "out",
    targetHandle: "in",
  }));
  return { nodes, edges };
}

/// Materialize a react-flow `Edge` from a hydrated spec with all visual
/// styling re-applied. Identical to the constructor in `CanvasSurface.onConnect`
/// — exported here so the load path produces the same shape user-drawn
/// edges have.
export function materializeEdge(spec: HydratedEdgeSpec): Edge {
  const styling = edgeStyleFor(spec.kind);
  return {
    id: spec.id,
    source: spec.source,
    target: spec.target,
    sourceHandle: spec.sourceHandle,
    targetHandle: spec.targetHandle,
    type: "default",
    style: styling.style,
    markerEnd: styling.markerEnd,
    label: styling.label,
    labelStyle: { fill: "#e6e6e6", fontSize: 12 },
    labelBgStyle: { fill: "#161616" },
    data: { kind: spec.kind },
  };
}

function nodeWidth(n: Node): number {
  if (n.style?.width !== undefined && typeof n.style.width === "number") {
    return n.style.width;
  }
  if (n.type === "terminal") return NODE_SIZE.terminal.width;
  if (n.type === "document") return NODE_SIZE.document.width;
  return NODE_SIZE.tombstone.width;
}

function nodeHeight(n: Node): number {
  if (n.style?.height !== undefined && typeof n.style.height === "number") {
    return n.style.height;
  }
  if (n.type === "terminal") return NODE_SIZE.terminal.height;
  if (n.type === "document") return NODE_SIZE.document.height;
  return NODE_SIZE.tombstone.height;
}
