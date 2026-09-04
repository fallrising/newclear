// Edge config + kind→style mapping. The canvas renders `triggers`
// (doc→terminal) and `feeds_output_to` (terminal→doc); `context_for`
// reserves its color so it can be added without re-theming later.

import type { Edge, EdgeMarker } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";

import type { SessionId } from "../../contracts/SessionId";

export type EdgeKind = "triggers" | "feeds_output_to" | "context_for";

/// Resolved input the AI panel ships as a pinned context block. Either a
/// vault document (read via doc_read) or a terminal whose scrollback is
/// snapshotted via pty_scrollback at send time.
export type ContextSource =
  | { kind: "doc"; path: string }
  | { kind: "terminal"; sessionId: SessionId; label: string };

/// The "context-out" handle id on the terminal node. Connecting from
/// this handle to a document's "in" target marks the edge as
/// `context_for` rather than `feeds_output_to`. The constant is exported
/// so TerminalNode and edges.ts can't drift.
export const TERMINAL_CONTEXT_HANDLE = "context-out";

export const EDGE_PALETTE: Record<EdgeKind, string> = {
  triggers: "#5a8aff",
  feeds_output_to: "#5ad08a",
  context_for: "#d09a5a",
};

export const EDGE_LABEL: Record<EdgeKind, string> = {
  triggers: "▶",
  feeds_output_to: "⇠",
  context_for: "≈",
};

export function edgeStyleFor(kind: EdgeKind): {
  style: Edge["style"];
  markerEnd: EdgeMarker;
  label: string;
} {
  const color = EDGE_PALETTE[kind];
  return {
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    label: EDGE_LABEL[kind],
  };
}

/// Direction-aware edge kind inference for a freshly drawn connection.
///
/// - doc → terminal                    : `triggers` (▶ injection target)
/// - terminal/right ("out") → doc      : `feeds_output_to` (pty:io batches
///                                       feed the doc's runnable-block
///                                       output sections)
/// - terminal/top  ("context-out") → doc : `context_for` (scrollback
///                                       becomes an AI context block)
/// - doc → doc                         : `context_for` (source doc body
///                                       becomes an AI context block)
///
/// Anything else, including connections involving tombstones, is rejected
/// (returns null) so the canvas drops the user's drag without creating an
/// orphan edge.
export function inferKindFromHandles(
  sourceType: "document" | "terminal" | "tombstone" | undefined,
  targetType: "document" | "terminal" | "tombstone" | undefined,
  sourceHandleId?: string | null,
): EdgeKind | null {
  if (sourceType === "document" && targetType === "terminal") return "triggers";
  if (sourceType === "terminal" && targetType === "document") {
    return sourceHandleId === TERMINAL_CONTEXT_HANDLE
      ? "context_for"
      : "feeds_output_to";
  }
  if (sourceType === "document" && targetType === "document") {
    return "context_for";
  }
  return null;
}
