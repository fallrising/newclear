import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlow } from "@xyflow/react";
import { getElementsToRemove } from "@xyflow/system";
import { CanvasSurface } from "./CanvasSurface";
import { DocumentNode } from "./DocumentNode";
import { DocumentCloseLifecycle } from "../document/close_lifecycle";

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
const closeIpc = vi.hoisted(() => ({ onWindowCloseRequested: vi.fn(), approveWindowClose: vi.fn() }));
vi.mock("./window_close_ipc", () => closeIpc);
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
let flow: any; let tree: any; let request: () => void;
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
  tree = inner.type(inner.props);
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
  closeIpc.approveWindowClose.mockResolvedValue(undefined);
  closeIpc.onWindowCloseRequested.mockImplementation(async (cb) => { request = cb; return () => {}; });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  native.invoke.mockImplementation(async (command) => command === "canvas_read" ? JSON.stringify(sidecar) : undefined);
  ipc.killPty.mockResolvedValue(undefined);
  ipc.onLoomEvent.mockResolvedValue(() => undefined);
});
afterEach(() => { harness.unmount(); vi.unstubAllGlobals(); });


const dialog = () => tree.props.children.find((child: any) => child?.props?.role === "dialog");
const buttons = () => dialog().props.children.filter((child: any) => child?.type === "button");
function register(id: string, dirty = true) {
  const state = { revision: "1", dirty, busy: false, canSave: true };
  const participant = { snapshot: () => ({ ...state }), save: vi.fn(async () => { state.dirty = false; return true; }) };
  node(id).data.registerWindowCloseParticipant(participant);
  return { state, participant };
}
describe("canvas native window close wiring", () => {
  it("registers hydrated and new document participants through DocumentNode", async () => {
    await mount(); const data = node("a").data;
    expect(data.registerWindowCloseParticipant).toBeTypeOf("function");
    const surface = DocumentNode({ data } as any).props.children[2].props.children;
    expect(surface.props.registerWindowCloseParticipant).toBe(data.registerWindowCloseParticipant);
    render({ x: 1, y: 2, path: "new.md" }); render();
    expect(nodes().find((n) => n.data.path === "new.md")?.data.registerWindowCloseParticipant).toBeTypeOf("function");
  });
  it("fails closed for unregistered documents and presents one deduplicated prompt", async () => {
    await mount(); request(); request(); render();
    expect(dialog().props["aria-modal"]).toBe(true);
    expect(buttons().map((button: any) => button.props.children)).toEqual(["Save all and exit", "Discard and exit", "Cancel"]);
    expect(closeIpc.approveWindowClose).not.toHaveBeenCalled();
    buttons()[2].props.onClick(); render(); expect(dialog()).toBeUndefined();
    expect(nodes()).toHaveLength(3); expect(edges()).toHaveLength(3);
  });
  it("saves all, flushes unchanged node/edge membership and keeps deletion blocked", async () => {
    await mount(); const a = register("a"); const b = register("b");
    request(); render(); await deleteSelection(["a", "t"]); expect(nodes()).toHaveLength(3);
    buttons()[0].props.onClick(); await settle(); render();
    expect(a.participant.save).toHaveBeenCalledOnce(); expect(b.participant.save).toHaveBeenCalledOnce();
    expect(closeIpc.approveWindowClose).toHaveBeenCalledOnce(); expect(nodes()).toHaveLength(3); expect(edges()).toHaveLength(3);
    const writes = native.invoke.mock.calls.filter(([command]) => command === "canvas_write"); expect(writes).toHaveLength(1);
    expect(writes[0]![1].content).toContain('"a"');
  });
  it("Discard never invokes save or node removal", async () => {
    await mount(); const a = register("a"); register("b"); request(); render();
    buttons()[1].props.onClick(); await settle(); render();
    expect(a.participant.save).not.toHaveBeenCalled(); expect(closeIpc.approveWindowClose).toHaveBeenCalledOnce(); expect(nodes()).toHaveLength(3);
  });
  it("Cancel while saving keeps nodes and revokes native close after completion", async () => {
    await mount(); const a = register("a"); const b = register("b"); let finish!: (value: boolean) => void;
    a.participant.save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    request(); render(); buttons()[0].props.onClick(); render();
    expect(buttons()[2].props.disabled).toBe(false); buttons()[2].props.onClick(); render();
    a.state.dirty = false; finish(true); await settle(); render();
    expect(dialog()).toBeUndefined(); expect(nodes()).toHaveLength(3); expect(edges()).toHaveLength(3);
    expect(b.participant.save).not.toHaveBeenCalled(); expect(closeIpc.approveWindowClose).not.toHaveBeenCalled();
  });
  it("honours an already approved node close completing behind the window prompt", async () => {
    await mount(); const data = node("a").data; let finish!: (value: boolean) => void; let dirty = true;
    const lifecycle = new DocumentCloseLifecycle(
      () => ({ generation: 1, revision: 1, version: 1, dirty, busy: false, canSave: true }),
      () => new Promise((resolve) => { finish = resolve; }), data.onClose, () => {},
    );
    data.registerCloseGuard(() => lifecycle.request()); lifecycle.request(); const saving = lifecycle.saveAndClose();
    request(); render(); dirty = false; finish(true); await saving; render();
    expect(node("a")).toBeUndefined(); expect(node("b")).toBeDefined(); expect(dialog()).toBeDefined();
    expect(closeIpc.approveWindowClose).not.toHaveBeenCalled(); expect(edges().map((edge) => edge.id)).toEqual(["b-t"]);
  });
  it("native failure restores the prompt and Cancel restores canvas deletion", async () => {
    await mount(); register("a", false); register("b", false);
    closeIpc.approveWindowClose.mockRejectedValueOnce(new Error("destroy failed")); request(); await settle(); render();
    expect(JSON.stringify(dialog())).toContain("destroy failed"); expect(buttons()[0].props.disabled).toBe(false);
    buttons()[2].props.onClick(); render(); await deleteSelection(["t"]); expect(nodes()).toHaveLength(2);
  });
  it("Save all waits for a previously admitted terminal spawn", async () => {
    await mount(); register("a", false); register("b", false);
    let release!: (value: string) => void; ipc.homeDir.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    harness.render(); const element = CanvasSurface({ addTerminalAt: { x: 0, y: 0 }, addDocumentAt: null, onConsumedAdd: consumed });
    const inner = element.props.children; tree = inner.type(inner.props); harness.effects();
    request(); render(); buttons()[0].props.onClick(); await settle(); render();
    expect(JSON.stringify(dialog())).toContain("operation in progress"); expect(closeIpc.approveWindowClose).not.toHaveBeenCalled();
    release("/vault"); await settle();
  });
  it("shows listener failure visibly and unregisters a late listener after unmount", async () => {
    closeIpc.onWindowCloseRequested.mockRejectedValueOnce(new Error("listener unavailable")); await mount();
    expect(JSON.stringify(tree)).toContain("listener unavailable"); expect(closeIpc.approveWindowClose).not.toHaveBeenCalled();
    harness.unmount(); harness.reset(); const off = vi.fn(); let resolve!: (value: () => void) => void;
    closeIpc.onWindowCloseRequested.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(); harness.unmount(); resolve(off); await settle(); expect(off).toHaveBeenCalledOnce();
  });
});
