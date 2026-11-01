import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlow } from "@xyflow/react";
import { getElementsToRemove } from "@xyflow/system";
import { CanvasSurface } from "./CanvasSurface";
import { DocumentNode } from "./DocumentNode";

// Exercise CanvasInner and its real React Flow deletion callback contract.
// The hook adapter follows the existing canvas lifecycle tests; no DOM shim.
const harness = vi.hoisted(() => {
  let cursor = 0;
  const slots: any[] = [];
  let queued: Array<() => void> = [];
  const same = (a: any[] | undefined, b: any[] | undefined) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const slot = () => { const index = cursor++; return slots[index] ?? (slots[index] = {}); };
  return {
    slots,
    reset() { slots.length = 0; cursor = 0; queued = []; },
    render() { cursor = 0; },
    effects() { const effects = queued; queued = []; effects.forEach((effect) => effect()); },
    unmount() { slots.forEach((entry) => entry.cleanup?.()); },
    useState(initial: any) { const entry = slot(); if (!("value" in entry)) { entry.value = typeof initial === "function" ? initial() : initial; entry.set = (value: any) => { entry.value = typeof value === "function" ? value(entry.value) : value; }; } return [entry.value, entry.set]; },
    useRef(initial: any) { const entry = slot(); return entry.ref ?? (entry.ref = { current: initial }); },
    useMemo(fn: () => any, deps: any[]) { const entry = slot(); if (!same(entry.deps, deps)) { entry.value = fn(); entry.deps = deps; } return entry.value; },
    useCallback(fn: any, deps: any[]) { const entry = slot(); if (!same(entry.deps, deps)) { entry.value = fn; entry.deps = deps; } return entry.value; },
    useEffect(fn: () => any, deps?: any[]) { const entry = slot(); if (!same(entry.deps, deps)) { entry.deps = deps; queued.push(() => { entry.cleanup?.(); entry.cleanup = fn(); }); } },
  };
});
const ipc = vi.hoisted(() => ({ spawnPty: vi.fn(), sessionMeta: vi.fn(), killPty: vi.fn(), homeDir: vi.fn(), onLoomEvent: vi.fn() }));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), ...harness }));
vi.mock("../../ipc", () => ipc);
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../document", () => ({ DocumentSurface: () => null }));
vi.mock("./TerminalNode", () => ({ TerminalNode: () => null }));
vi.mock("./TombstoneNode", () => ({ TombstoneNode: () => null }));
vi.mock("./SessionHistory", () => ({ SessionHistory: () => null }));


const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const consumed = vi.fn();
let flow: any;
const documentSpec = (id: string) => ({ id, kind: { type: "document", path: `${id}.md` }, x: 0, y: 0, w: 800, h: 500, group: null });
const tomb = { id: "t", kind: { type: "tombstone", reason: "exited", was: { type: "terminal", cwd: "/vault", shell: "sh", cmd: null } }, x: 0, y: 0, w: 300, h: 150, group: null };
const sidecar = { version: 1, nodes: [documentSpec("a"), documentSpec("b"), tomb], edges: [
  { id: "a-t", from: "a", to: "t", kind: "triggers" },
  { id: "b-t", from: "b", to: "t", kind: "triggers" },
  { id: "a-b", from: "a", to: "b", kind: "context_for" },
] };
function render(addDocumentAt: { x: number; y: number; path: string } | null = null) {
  harness.render();
  const element = CanvasSurface({ addTerminalAt: null, addDocumentAt, onConsumedAdd: consumed });
  const inner = element.props.children;
  const tree = inner.type(inner.props);
  flow = tree.props.children.find((child: any) => child?.type === ReactFlow).props;
  harness.effects();
}
async function mount() { render(); await settle(); render(); await settle(); render(); }
const nodes = () => harness.slots[0].value as any[];
const edges = () => harness.slots[1].value as any[];
const node = (id: string) => nodes().find((n) => n.id === id)!;
async function deleteSelection(nodeIds: string[], edgeIds: string[] = []) {
  const removal = await getElementsToRemove({
    nodes: flow.nodes, edges: flow.edges,
    nodesToRemove: nodeIds.map((id) => ({ id })), edgesToRemove: edgeIds.map((id) => ({ id })),
    onBeforeDelete: flow.onBeforeDelete,
  });
  // This is the installed React Flow deleteElements order: edges first.
  flow.onEdgesChange(removal.edges.map(({ id }) => ({ id, type: "remove" })));
  flow.onNodesChange(removal.nodes.map(({ id }) => ({ id, type: "remove" })));
  render(); await settle(); render();
}
beforeEach(() => {
  harness.reset(); vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  native.invoke.mockImplementation(async (command) => command === "canvas_read" ? JSON.stringify(sidecar) : undefined);
  ipc.killPty.mockResolvedValue(undefined);
  ipc.onLoomEvent.mockResolvedValue(() => undefined);
});
afterEach(() => { harness.unmount(); vi.unstubAllGlobals(); });

describe("actual canvas document close routes", () => {
  it("fails closed before a guard mounts and retains every incident edge", async () => {
    await mount(); await deleteSelection(["a"], ["a-t"]);
    expect(nodes().map((n) => n.id)).toEqual(["a", "b", "t"]);
    expect(edges().map((e) => e.id)).toEqual(["a-t", "b-t", "a-b"]);
  });
  it("registers hydrated/new nodes and forwards the exact registration to the surface", async () => {
    await mount();
    expect(node("a").data.registerCloseGuard).toBeTypeOf("function");
    const surface = DocumentNode({ data: node("a").data } as any).props.children[2].props.children;
    expect(surface.props.registerCloseGuard).toBe(node("a").data.registerCloseGuard);
    render({ x: 1, y: 2, path: "new.md" }); render();
    expect(nodes().find((n) => n.data.path === "new.md")?.data.registerCloseGuard).toBeTypeOf("function");
  });
  it("retains a pending document and wiring on repeated requests until approved close", async () => {
    await mount(); const data = node("a").data; const request = vi.fn(); data.registerCloseGuard(request);
    await deleteSelection(["a"]); await deleteSelection(["a"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(node("a")).toBeDefined(); expect(edges()).toHaveLength(3);
    data.onClose(); render();
    expect(node("a")).toBeUndefined(); expect(edges().map((e) => e.id)).toEqual(["b-t"]);
    expect(request).toHaveBeenCalledTimes(2); expect(ipc.killPty).not.toHaveBeenCalled();
  });
  it("requests each selected document independently while clean approval removes only its wiring", async () => {
    await mount(); const pending = vi.fn(); const cleanData = node("b").data;
    node("a").data.registerCloseGuard(pending); cleanData.registerCloseGuard(cleanData.onClose);
    await deleteSelection(["a", "b"]);
    expect(pending).toHaveBeenCalledOnce(); expect(nodes().map((n) => n.id)).toEqual(["a", "t"]);
    expect(edges().map((e) => e.id)).toEqual(["a-t"]);
  });
  it("preserves run_in routing while pending and removes it with approved close", async () => {
    await mount();
    harness.slots[0].set((previous: any[]) => previous.map((n) => n.id === "t" ? { ...n, type: "terminal", data: { sessionId: "live-session", name: "shell" } } : n));
    render(); const data = node("a").data; data.registerCloseGuard(vi.fn());
    data.onRunInChange("shell"); render(); render();
    expect(edges().find((e) => e.id === "e-runin-a")).toMatchObject({ source: "a", target: "t" });
    await deleteSelection(["a"]);
    expect(node("a").data).toMatchObject({ runInName: "shell", runInMatched: true });
    expect(edges().find((e) => e.id === "e-runin-a")).toBeDefined();
    data.onClose(); render(); render();
    expect(edges().find((e) => e.id === "e-runin-a")).toBeUndefined();
    expect(node("t")).toBeDefined(); expect(ipc.killPty).not.toHaveBeenCalled();
  });
  it("does not let old registration cleanup remove a replacement, even with the same callback", async () => {
    await mount(); const data = node("a").data; const request = vi.fn();
    const oldCleanup = data.registerCloseGuard(request); const cleanup = data.registerCloseGuard(request);
    oldCleanup(); await deleteSelection(["a"]); expect(request).toHaveBeenCalledOnce();
    cleanup(); await deleteSelection(["a"]); expect(request).toHaveBeenCalledOnce(); expect(node("a")).toBeDefined();
  });
  it("routes direct remove changes through the guard and approved Close bypasses it", async () => {
    await mount(); const data = node("a").data; const request = vi.fn(); data.registerCloseGuard(request);
    flow.onNodesChange([{ id: "a", type: "remove" }]); render();
    expect(request).toHaveBeenCalledOnce(); expect(node("a")).toBeDefined();
    data.onClose(); render(); expect(node("a")).toBeUndefined(); expect(request).toHaveBeenCalledOnce();
  });
  it("allows independent edge deletion and tombstone deletion", async () => {
    await mount(); await deleteSelection([], ["a-t"]);
    expect(nodes()).toHaveLength(3); expect(edges().map((e) => e.id)).toEqual(["b-t", "a-b"]);
    await deleteSelection(["t"]); expect(nodes().map((n) => n.id)).toEqual(["a", "b"]);
    expect(edges().map((e) => e.id)).toEqual(["a-b"]);
  });
  it("cleans an independently selected live terminal once while preserving pending documents", async () => {
    await mount();
    harness.slots[0].set((previous: any[]) => previous.map((n) => n.id === "t" ? { ...n, type: "terminal", data: { sessionId: "live-session" } } : n));
    render(); const request = vi.fn(); node("a").data.registerCloseGuard(request);
    await deleteSelection(["a", "t"]);
    expect(node("a")).toBeDefined(); expect(node("t")).toBeUndefined();
    expect(edges().map((e) => e.id)).toEqual(["a-b"]);
    expect(ipc.killPty).toHaveBeenCalledExactlyOnceWith("live-session");
    flow.onNodesChange([{ id: "t", type: "remove" }]); expect(ipc.killPty).toHaveBeenCalledOnce();
  });
  it.each(["Backspace", "Delete"])("keeps %s in document editor, input and prompt controls", async (key) => {
    await mount();
    const body = DocumentNode({ data: node("a").data } as any).props.children[2];
    for (const target of ["editor", "input", "prompt-button"]) {
      const stopPropagation = vi.fn(); const preventDefault = vi.fn();
      body.props.onKeyDown({ key, target, stopPropagation, preventDefault });
      expect(stopPropagation).toHaveBeenCalledOnce(); expect(preventDefault).not.toHaveBeenCalled();
    }
    const stopPropagation = vi.fn(); body.props.onKeyDown({ key: "ArrowLeft", stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
