import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../contracts/SessionMeta";
import { appendHistoryNode, withObservedExit } from "./recoveryCanvas";

const meta: SessionMeta = { id: "new", cwd: "/saved", shell: "/bin/bash", cmd: "make", state: { kind: "active" }, last_activity_ms: 0n };
const hooks = { kill: vi.fn(), close: vi.fn(), rename: vi.fn(), restart: vi.fn(), dismiss: vi.fn() };
describe("history canvas insertion", () => {
  it("adds a fresh session without replacing documents, old tombstones, layout or dirty editor data", () => {
    const document = { id: "d", type: "document", position: { x: 4, y: 9 }, data: { path: "note.md", dirty: "unsaved" } };
    const old = { id: "t-old", type: "tombstone", position: { x: 99, y: 12 }, data: { reason: "old" } };
    const nodes = appendHistoryNode([document, old], meta, { x: 20, y: 30 }, hooks);
    expect(nodes[0]).toBe(document); expect(nodes[1]).toBe(old);
    expect(nodes[2]).toMatchObject({ id: "t-new", type: "terminal", position: { x: 20, y: 30 }, data: { sessionId: "new", cwd: "/saved", cmd: "make", shell: "/bin/bash" } });
    expect(appendHistoryNode(nodes, meta, { x: 0, y: 0 }, hooks)).toBe(nodes);
  });
  it("creates a tombstone for a child that exits before metadata reaches the canvas", () => {
    const node = appendHistoryNode([], { ...meta, state: { kind: "exited", code: 7 } }, { x: 0, y: 0 }, hooks)[0];
    expect(node).toMatchObject({ type: "tombstone", data: { reason: "exited with code 7", exitCode: 7, was: { cwd: "/saved", cmd: "make", shell: "/bin/bash" } } });
    (node!.data.onRestart as () => void)(); expect(hooks.restart).toHaveBeenCalledWith("t-new", expect.objectContaining({ cwd: "/saved" }));
  });
  it("retains a fast exit notification received before stale active metadata returns", () => {
    const exits = new Map([["new", 3]]);
    const resolved = withObservedExit(meta, exits);
    expect(appendHistoryNode([], resolved, { x: 0, y: 0 }, hooks)[0]).toMatchObject({ type: "tombstone", data: { exitCode: 3 } });
    expect(withObservedExit(meta, new Map())).toBe(meta);
  });
});
