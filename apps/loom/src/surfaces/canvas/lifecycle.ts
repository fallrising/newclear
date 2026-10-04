import type { Node } from "@xyflow/react";
import { readCanvasSidecar, writeCanvasSidecar, type CanvasSidecar } from "./persistence";

export class CanvasStorage {
  private ready = false;
  private writes: Promise<unknown> = Promise.resolve();
  async load() { this.ready = false; const value = await readCanvasSidecar(); this.ready = true; return value; }
  save(value: CanvasSidecar): Promise<void> {
    if (!this.ready) return Promise.reject(new Error("Canvas autosave blocked until successful hydration"));
    const operation = this.writes.then(() => writeCanvasSidecar(value));
    this.writes = operation.catch(() => undefined);
    return operation;
  }
}

export function removalPlan(nodes: Node[], ids: string[]) {
  const removed = nodes.filter((node) => ids.includes(node.id));
  return {
    ids,
    sessions: removed.flatMap((node) => node.type === "terminal" && typeof node.data.sessionId === "string" ? [node.data.sessionId] : []),
    documents: removed.filter((node) => node.type === "document").map((node) => node.id),
  };
}

export function withoutKeys<T>(map: Map<string, T>, keys: string[]): Map<string, T> {
  const next = new Map(map);
  keys.forEach((key) => next.delete(key));
  return next;
}
