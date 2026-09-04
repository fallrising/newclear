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
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasSidecar>;
    if (parsed.version !== CANVAS_VERSION) {
      // eslint-disable-next-line no-console
      console.warn(
        `canvas.json version ${String(parsed.version)} != ${CANVAS_VERSION}; ignoring`,
      );
      return null;
    }
    return {
      version: CANVAS_VERSION,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("canvas.json parse failed", e);
    return null;
  }
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
      group: null,
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
      if (!d.reason || !d.was) continue;
      out.push({
        id: n.id,
        ...pos,
        kind: { type: "tombstone", reason: d.reason, was: d.was },
      });
    }
  }
  return out;
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
  return out;
}

/// Hydration helpers — these produce *partial* react-flow nodes and edges.
/// The CanvasSurface fills in the runtime-only fields (callbacks, etc.)
/// at mount time because they reference live closures.
export interface HydratedTerminalSpec {
  kind: "tombstone";
  id: string;
  position: { x: number; y: number };
  reason: string;
  was: SidecarTombstoneWas;
}

export interface HydratedDocumentSpec {
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
}

export interface HydratedSidecar {
  nodes: HydratedNodeSpec[];
  edges: HydratedEdgeSpec[];
}

export function hydrate(sidecar: CanvasSidecar): HydratedSidecar {
  const nodes: HydratedNodeSpec[] = [];
  for (const n of sidecar.nodes) {
    const position = { x: n.x, y: n.y };
    if (n.kind.type === "document") {
      nodes.push({ kind: "document", id: n.id, position, path: n.kind.path });
    } else if (n.kind.type === "tombstone") {
      nodes.push({
        kind: "tombstone",
        id: n.id,
        position,
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
