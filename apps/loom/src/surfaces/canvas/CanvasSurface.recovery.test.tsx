import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface } from "./CanvasSurface";
import { SessionHistoryController } from "./history";

// Execute CanvasInner's real lifecycle with a small hook adapter. This avoids
// DOM dependencies while tracing its actual async spawn/restart effect paths.
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
vi.mock("./DocumentNode", () => ({ DocumentNode: () => null }));
vi.mock("./TerminalNode", () => ({ TerminalNode: () => null }));
vi.mock("./TombstoneNode", () => ({ TombstoneNode: () => null }));
vi.mock("./SessionHistory", () => ({ SessionHistory: () => null }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const meta = { id: "fresh", cwd: "/vault", cmd: "echo saved", shell: "/bin/sh", state: { kind: "active" }, last_activity_ms: 0n };
const tomb = { id: "old-node", x: 10, y: 20, w: 600, h: 300, group: "group", kind: { type: "tombstone", reason: "saved", was: { type: "terminal", cwd: "/vault", cmd: "echo saved", shell: "/bin/sh", name: "named" } } };
let exited: (event: any) => Promise<void>;
let controllers: SessionHistoryController[] = [];
function render(add = false) {
  harness.render();
  const element = CanvasSurface({ addTerminalAt: add ? { x: 30, y: 40 } : null, addDocumentAt: null, onConsumedAdd: consumed });
  const inner = element.props.children;
  inner.type(inner.props);
  harness.effects();
}
const consumed = vi.fn();
async function mount(add = false) { render(add); await settle(); render(add); await settle(); }
beforeEach(() => {
  harness.reset(); vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  native.invoke.mockImplementation(async (command: string) => command === "canvas_read" ? null : undefined);
  ipc.homeDir.mockResolvedValue("/vault"); ipc.spawnPty.mockResolvedValue("fresh"); ipc.killPty.mockResolvedValue(undefined);
  ipc.onLoomEvent.mockImplementation(async (handler) => { exited = handler; return () => undefined; });
});
afterEach(() => { harness.unmount(); controllers.forEach((controller) => controller.dispose()); controllers = []; vi.unstubAllGlobals(); });

describe("actual canvas recovery attachment paths", () => {
  it.each([
    ["normal spawn", "during metadata read"], ["canvas restart", "during metadata read"],
    ["normal spawn", "before spawn returns"], ["canvas restart", "before spawn returns"],
  ])("does not route an ended %s as active when exit arrives %s", async (path, timing) => {
    const metadata = deferred<any>(); ipc.sessionMeta.mockReturnValue(metadata.promise);
    const spawn = deferred<string>(); if (timing === "before spawn returns") ipc.spawnPty.mockReturnValue(spawn.promise);
    if (path === "canvas restart") native.invoke.mockImplementation(async (command) => command === "canvas_read" ? JSON.stringify({ version: 1, nodes: [tomb], edges: [{ id: "loop", from: tomb.id, to: tomb.id, kind: "triggers" }] }) : undefined);
    await mount(path === "normal spawn");
    if (path === "canvas restart") {
      const restart = harness.slots[0].value[0].data.onRestart;
      harness.slots[0].set((nodes: any[]) => nodes.map((node) => ({ ...node, data: { ...node.data, was: { ...node.data.was, name: "renamed" } } })));
      render(); restart(); await settle();
    }
    if (timing === "during metadata read") {
      expect(ipc.sessionMeta).toHaveBeenCalledWith("fresh");
      expect(harness.slots[0].value.some((node: any) => node.type === "terminal")).toBe(false);
    }
    const event = exited({ kind: "pty_exited", session_id: "fresh", exit_code: 9 });
    if (timing === "before spawn returns") { spawn.resolve("fresh"); await settle(); }
    metadata.resolve(meta); await event; await settle();
    expect(harness.slots[0].value[0]).toMatchObject({ type: "tombstone", data: { exitCode: 9, was: { cwd: "/vault" } } });
    expect(harness.slots[2].value.get("fresh")).toBeUndefined();
    if (path === "canvas restart") {
      expect(harness.slots[0].value[0]).toMatchObject({ id: "t-fresh", position: { x: 10, y: 20 }, style: { width: 600, height: 300 }, data: { sidecarGroup: "group", was: { name: "renamed" } } });
      expect(harness.slots[1].value[0]).toMatchObject({ source: "t-fresh", target: "t-fresh" });
    }
  });
  it.each(["normal spawn", "canvas restart"])("retains failed late unmounted %s cleanup for the next history view", async (path) => {
    const spawn = deferred<string>(); ipc.spawnPty.mockReturnValue(spawn.promise); ipc.sessionMeta.mockResolvedValue(meta);
    if (path === "canvas restart") native.invoke.mockImplementation(async (command) => command === "canvas_read" ? JSON.stringify({ version: 1, nodes: [tomb], edges: [] }) : undefined);
    await mount(path === "normal spawn");
    if (path === "canvas restart") { (harness.slots[0].value[0].data.onRestart as () => void)(); await settle(); }
    harness.unmount(); ipc.killPty.mockRejectedValueOnce(new Error("late cleanup failure")); spawn.resolve("fresh"); await settle();
    const controller = new SessionHistoryController({ listen: async () => () => undefined, read: async () => ({ sessions: [], live_session_ids: [], persistent: true, warning: null }), restart: async () => "unused", forget: async () => undefined, meta: async () => null, kill: ipc.killPty }, () => undefined, () => false);
    controllers.push(controller); await controller.start();
    expect(controller.state.cleanupErrors.get("fresh")).toContain("late cleanup failure");
    await controller.retryCleanup("fresh"); expect(controller.state.cleanupErrors.size).toBe(0);
  });
});
