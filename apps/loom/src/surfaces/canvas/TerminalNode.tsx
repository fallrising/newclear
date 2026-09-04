import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { SessionId } from "../../contracts/SessionId";
import { TerminalView } from "../../Terminal";

import { CSS, NODE_SIZE } from "./config";
import { TERMINAL_CONTEXT_HANDLE } from "./edges";

export interface TerminalNodeData {
  sessionId: SessionId;
  /// Spawn config preserved so persistence can save terminals as
  /// tombstones (the only durable form, since session IDs are ephemeral).
  cwd: string;
  cmd: string | null;
  shell: string;
  /// Optional user-given name. When set, runnable blocks can route to
  /// this terminal via `run_in: <name>` frontmatter (D-6 step 1).
  name?: string | null;
  onKill: () => void;
  onClose: () => void;
  onRename: (next: string | null) => void;
  exitCode?: number | null;
}

export function TerminalNode({ data }: NodeProps) {
  const d = data as unknown as TerminalNodeData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(d.name ?? "");

  const commit = () => {
    const trimmed = draft.trim();
    d.onRename(trimmed === "" ? null : trimmed);
    setEditing(false);
  };

  return (
    <div
      className={CSS.nodeFrame}
      style={{ width: NODE_SIZE.terminal.width, height: NODE_SIZE.terminal.height }}
    >
      {/* Terminals receive `triggers` edges (left handle) and emit
          `feeds_output_to` edges (right handle). The top "context-out"
          handle emits `context_for` — drag from here to a doc to pin
          the scrollback into that doc's AI prompt as a cached context
          block. */}
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle
        type="source"
        position={Position.Top}
        id={TERMINAL_CONTEXT_HANDLE}
        style={{ background: "#d09a5a" }}
        title="drag to a doc to pin scrollback as AI context"
      />
      <div className={CSS.nodeHeader}>
        <strong>terminal</strong>
        {editing ? (
          <input
            className="loom-name-input nodrag"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(d.name ?? "");
                setEditing(false);
              }
            }}
            onBlur={commit}
            placeholder="name"
          />
        ) : (
          <button
            className="loom-name-button"
            title="rename — referenced by `run_in:` in a document's frontmatter"
            onClick={() => {
              setDraft(d.name ?? "");
              setEditing(true);
            }}
          >
            {d.name ?? "(rename)"}
          </button>
        )}
        <span className="sid">{d.sessionId}</span>
        <button onClick={d.onKill}>kill</button>
        <button onClick={d.onClose}>close</button>
        {d.exitCode !== undefined && (
          <span className="meta">exited (code={String(d.exitCode)})</span>
        )}
      </div>
      {/* `nodrag nowheel` are react-flow conventions: pointer / wheel
          events here pass through to xterm so the user can type, select
          text, and scroll without dragging or zooming the canvas. */}
      <div className={`${CSS.nodeBody} nodrag nowheel`}>
        <TerminalView sessionId={d.sessionId} />
      </div>
    </div>
  );
}
