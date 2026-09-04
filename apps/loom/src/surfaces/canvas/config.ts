// Declarative locks for the canvas surface. Node sizes, default placement
// stride, palette — everything visual lives here.

export const NODE_SIZE = {
  terminal: { width: 640, height: 360 },
  document: { width: 560, height: 420 },
  tombstone: { width: 320, height: 140 },
} as const;

/// When the user clicks "add terminal" / "add document" we place the new
/// node at a stride-based offset from the existing ones — boring but
/// avoids overlap until automatic layout lands.
export const PLACEMENT_STRIDE = { x: 80, y: 80 } as const;

export const CSS = {
  canvasRoot: "loom-canvas-root",
  nodeFrame: "loom-canvas-node-frame",
  nodeHeader: "loom-canvas-node-header",
  nodeBody: "loom-canvas-node-body",
} as const;
