import { Handle, Position, type NodeProps } from "@xyflow/react";

import { CSS, NODE_SIZE } from "./config";

export interface TombstoneNodeData {
  reason: string;
  /// The original spawn config so the restart button can reuse it.
  /// `name` carries the optional `run_in:` target name forward across
  /// restart so a doc that references the terminal by name keeps working.
  was: {
    cwd: string;
    cmd: string | null;
    shell: string;
    name?: string | null;
  };
  /// Exit code if known (None on signal-kill on macOS).
  exitCode?: number | null;
  onRestart: () => void;
  onDismiss: () => void;
}

export function TombstoneNode({ data }: NodeProps) {
  const d = data as unknown as TombstoneNodeData;
  return (
    <div
      className={`${CSS.nodeFrame} loom-canvas-tombstone`}
      style={{ width: NODE_SIZE.tombstone.width, height: NODE_SIZE.tombstone.height }}
    >
      {/* A tombstone keeps the incoming-triggers handle so a doc's
          existing edge stays valid; restart updates the same edge to
          point at the new live session. */}
      <Handle type="target" position={Position.Left} />
      <div className={CSS.nodeHeader}>
        <strong>session ended</strong>
        {d.was.name && <span className="sid">{d.was.name}</span>}
        {d.exitCode !== undefined && d.exitCode !== null && (
          <span className="meta">code={d.exitCode}</span>
        )}
      </div>
      <div className="loom-canvas-tombstone-body">
        <div className="tomb-reason">{d.reason}</div>
        <div className="tomb-cmd">
          <code>
            {d.was.cmd ?? d.was.shell} @ {d.was.cwd}
          </code>
        </div>
        <div className="tomb-actions">
          <button onClick={d.onRestart}>restart</button>
          <button onClick={d.onDismiss}>dismiss</button>
        </div>
      </div>
    </div>
  );
}
