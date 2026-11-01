import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CanvasStorage, removalPlan, withoutKeys } from "./lifecycle";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const payload = { version: 1, nodes: [], edges: [] };
describe("canvas persistence and deletion lifecycle", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  it("blocks autosave before successful hydration including failed reads", async () => {
    const store = new CanvasStorage();
    await expect(store.save(payload)).rejects.toThrow(/hydration/i);
    vi.mocked(invoke).mockResolvedValue("{");
    await expect(store.load()).rejects.toThrow();
    await expect(store.save(payload)).rejects.toThrow(/hydration/i);
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(["canvas_read"]);
  });
  it("allows missing initialization and exposes failed writes for an explicit retry", async () => {
    const store = new CanvasStorage();
    vi.mocked(invoke).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    expect(await store.load()).toBeNull();
    await expect(store.save(payload)).rejects.toThrow("disk full");
    await store.save(payload);
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(["canvas_read", "canvas_write", "canvas_write"]);
  });
  it("keyboard and Close removal plans clean sessions and document run_in entries", () => {
    const nodes = [{ id: "t", type: "terminal", position: { x: 0, y: 0 }, data: { sessionId: "session" } }, { id: "d", type: "document", position: { x: 0, y: 0 }, data: { path: "doc.md" } }];
    const plan = removalPlan(nodes, ["t", "d"]);
    expect(plan.sessions).toEqual(["session"]);
    expect(plan.documents).toEqual(["d"]);
    expect(withoutKeys(new Map([["session", { id: "session" }]]), plan.sessions).size).toBe(0);
    expect(withoutKeys(new Map([["d", "shell"]]), plan.documents).size).toBe(0);
  });
  it("serializes sidecar writes so an older request cannot finish over newer data", async () => {
    const store = new CanvasStorage();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(invoke).mockResolvedValueOnce(null).mockImplementationOnce(() => pending).mockResolvedValueOnce(undefined);
    await store.load();
    const first = store.save(payload);
    const second = store.save({ ...payload, edges: [] });
    await Promise.resolve();
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(["canvas_read", "canvas_write"]);
    finish(); await Promise.all([first, second]);
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(["canvas_read", "canvas_write", "canvas_write"]);
  });
  it("explicit read retry can recover after an invalid sidecar without any intervening write", async () => {
    const store = new CanvasStorage();
    vi.mocked(invoke).mockResolvedValueOnce("{").mockResolvedValueOnce(JSON.stringify(payload)).mockResolvedValueOnce(undefined);
    await expect(store.load()).rejects.toThrow();
    expect(await store.load()).toEqual(payload);
    await store.save(payload);
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(["canvas_read", "canvas_read", "canvas_write"]);
  });
});
