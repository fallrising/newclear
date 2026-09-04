import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { SessionId } from "../../contracts/SessionId";
import { DocumentSurface } from "../document";

import { CSS, NODE_SIZE } from "./config";
import type { ContextSource } from "./edges";

export interface DocumentNodeData {
  path: string;
  /// Resolved D-6 target: outgoing `triggers` edge target (if any),
  /// else the canvas-level active terminal fallback. The canvas owns
  /// resolution; the node just receives the answer.
  triggersTarget: SessionId | null;
  /// Sessions whose Pin-snapshot path should land in this doc — derived
  /// from incoming `feeds_output_to` edges. Currently unused; reserved
  /// for the Pin button (TDD §8 step 5, not yet implemented). We keep
  /// the data flowing so that when Pin lands it's a one-line wire-up.
  feedingTerminalIds: SessionId[];
  /// Context sources whose content should be pinned into this doc's AI
  /// prompt — derived from incoming `context_for` edges. Each source is
  /// either a vault document or a live terminal scrollback.
  pinnedContextSources: ContextSource[];
  /// Current `run_in:` frontmatter value (null if absent / empty), and
  /// whether it resolves to a known terminal. Surfaces the D-6 step 1
  /// state to the user so they know when to rename a terminal.
  runInName: string | null;
  runInMatched: boolean;
  onClose: () => void;
  /// Forwarded to DocumentSurface so the canvas can materialize a
  /// synthetic triggers edge per D-6 step 1.
  onRunInChange?: (name: string | null) => void;
}

export function DocumentNode({ data }: NodeProps) {
  const d = data as unknown as DocumentNodeData;
  return (
    <div
      className={CSS.nodeFrame}
      style={{ width: NODE_SIZE.document.width, height: NODE_SIZE.document.height }}
    >
      {/* Left handle accepts `feeds_output_to` from a terminal. */}
      <Handle type="target" position={Position.Left} id="in" />
      {/* Tiny header acts as the drag handle for this node. The body
          below is `nodrag`, which would otherwise leave nothing for
          react-flow to grab. */}
      <div className={CSS.nodeHeader}>
        <strong>document</strong>
        <span className="sid">{d.path}</span>
        {d.runInName && (
          <span
            className={`loom-runin-status ${
              d.runInMatched ? "matched" : "unmatched"
            }`}
            title={
              d.runInMatched
                ? `▶ routes via run_in: ${d.runInName}`
                : `no terminal named "${d.runInName}" — rename one to match`
            }
          >
            run_in: {d.runInName}{" "}
            {d.runInMatched ? "→ matched" : "→ no match"}
          </span>
        )}
      </div>
      {/* `nodrag nowheel` so editor input, selection, and scrolling go
          to CodeMirror instead of the canvas drag layer. */}
      <div className={`${CSS.nodeBody} nodrag nowheel`}>
        <DocumentSurface
          path={d.path}
          onClose={d.onClose}
          activeTerminalId={d.triggersTarget}
          onRunInChange={d.onRunInChange}
          pinnedContextSources={d.pinnedContextSources}
        />
      </div>
      {/* Right handle emits `triggers` to a terminal. */}
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}
