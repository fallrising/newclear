import { describe, expect, it, vi } from "vitest";
import { WindowCloseCoordinator } from "./window_close";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function setup() {
  let ids = ["a", "b"]; let ready = true;
  const approve = vi.fn(async () => {}); const flush = vi.fn(async () => {}); const changed = vi.fn();
  const coordinator = new WindowCloseCoordinator({ expected: () => ready ? ids : null, approve, flush, changed });
  const participant = (dirty = true) => {
    const state = { revision: "1", dirty, busy: false, canSave: true };
    const p = { snapshot: () => ({ ...state }), save: vi.fn(async () => { state.dirty = false; return true; }) };
    return { state, p };
  };
  const a = participant(); const b = participant(); coordinator.register("a", a.p); coordinator.register("b", b.p);
  return { coordinator, a, b, approve, flush, changed, participant, ids: (next: string[]) => { ids = next; }, ready: (next: boolean) => { ready = next; } };
}
describe("window close decision", () => {
  it("closes clean documents after flushing; dirty requests deduplicate and Cancel retains participants", async () => {
    const s = setup(); s.a.state.dirty = false; s.b.state.dirty = false;
    await s.coordinator.request(); expect(s.flush).toHaveBeenCalledOnce(); expect(s.approve).toHaveBeenCalledOnce();
    const t = setup(); await t.coordinator.request(); await t.coordinator.request();
    expect(t.coordinator.state.phase).toBe("prompt"); expect(t.approve).not.toHaveBeenCalled();
    t.coordinator.cancel(); expect(t.coordinator.state.phase).toBe("idle"); expect(t.a.p.save).not.toHaveBeenCalled();
  });
  it("Save all saves every dirty document without removal, then closes", async () => {
    const s = setup(); await s.coordinator.request(); await s.coordinator.saveAll();
    expect(s.a.p.save).toHaveBeenCalledOnce(); expect(s.b.p.save).toHaveBeenCalledOnce(); expect(s.approve).toHaveBeenCalledOnce();
  });
  it("Discard performs no document writes and final dispatch is frozen", async () => {
    const s = setup(); const gate = deferred<void>(); s.approve.mockImplementation(() => gate.promise);
    await s.coordinator.request(); const run = s.coordinator.discard(); await Promise.resolve(); await Promise.resolve();
    expect(s.coordinator.state.phase).toBe("committing"); s.coordinator.cancel();
    expect(s.coordinator.state.phase).toBe("committing"); expect(s.a.p.save).not.toHaveBeenCalled(); gate.resolve(); await run;
  });
  it.each(["busy", "canSave"])("refuses unsafe %s state before starting any save", async (field) => {
    const s = setup(); s.b.state[field as "busy" | "canSave"] = field === "busy";
    await s.coordinator.request(); await s.coordinator.saveAll();
    expect(s.a.p.save).not.toHaveBeenCalled(); expect(s.approve).not.toHaveBeenCalled(); expect(s.coordinator.state.error).toBeTruthy();
  });
  it("fails closed for unready canvas, missing or stale participants", async () => {
    const s = setup(); s.ready(false); await s.coordinator.request(); await s.coordinator.saveAll(); expect(s.approve).not.toHaveBeenCalled();
    s.ready(true); s.ids(["a", "b", "c"]); await s.coordinator.saveAll(); expect(s.approve).not.toHaveBeenCalled();
    s.ids(["a", "b"]); s.a.p.snapshot = () => null as any; await s.coordinator.saveAll(); expect(s.approve).not.toHaveBeenCalled();
  });
  it("keeps partial successes when a later document fails", async () => {
    const s = setup(); s.b.p.save.mockResolvedValue(false); await s.coordinator.request(); await s.coordinator.saveAll();
    expect(s.a.state.dirty).toBe(false); expect(s.approve).not.toHaveBeenCalled(); expect(s.coordinator.state.error).toBeTruthy();
  });
  it.each(["revision", "membership", "replacement", "busy"])("rechecks %s across all saves", async (change) => {
    const s = setup(); const gate = deferred<boolean>(); s.b.p.save.mockImplementation(() => gate.promise);
    await s.coordinator.request(); const run = s.coordinator.saveAll(); await Promise.resolve(); await Promise.resolve();
    if (change === "revision") s.a.state.revision = "2";
    if (change === "membership") s.ids(["a"]);
    if (change === "replacement") s.coordinator.register("a", s.participant(false).p);
    if (change === "busy") s.a.state.busy = true;
    s.b.state.dirty = false; gate.resolve(true); await run; expect(s.approve).not.toHaveBeenCalled();
  });
  it("rechecks revisions after sidecar flush", async () => {
    const s = setup(); s.flush.mockImplementation(async () => { s.a.state.revision = "2"; });
    await s.coordinator.request(); await s.coordinator.saveAll(); expect(s.approve).not.toHaveBeenCalled();
  });
  it("Cancel revokes a pending save and duplicate saves never start another operation", async () => {
    const s = setup(); const gate = deferred<boolean>(); s.a.p.save.mockImplementation(() => gate.promise);
    await s.coordinator.request(); const run = s.coordinator.saveAll(); await s.coordinator.saveAll(); s.coordinator.cancel();
    await s.coordinator.request(); await s.coordinator.saveAll(); expect(s.a.p.save).toHaveBeenCalledOnce();
    s.a.state.dirty = false; gate.resolve(true); await run; expect(s.approve).not.toHaveBeenCalled(); expect(s.b.p.save).not.toHaveBeenCalled();
  });
  it("explicit Discard can supersede a cancelled submitted save without starting more writes", async () => {
    const s = setup(); const gate = deferred<boolean>(); s.a.p.save.mockImplementation(() => gate.promise);
    await s.coordinator.request(); const saving = s.coordinator.saveAll(); s.coordinator.cancel();
    await s.coordinator.request(); await s.coordinator.discard(); expect(s.approve).toHaveBeenCalledOnce();
    gate.resolve(true); await saving; expect(s.approve).toHaveBeenCalledOnce(); expect(s.b.p.save).not.toHaveBeenCalled();
  });
  it("disposal revokes in-flight saves and activation does not revive their exit intent", async () => {
    const s = setup(); const gate = deferred<boolean>(); s.a.p.save.mockImplementation(() => gate.promise);
    await s.coordinator.request(); const saving = s.coordinator.saveAll(); s.coordinator.dispose(); s.coordinator.activate();
    gate.resolve(true); await saving; expect(s.approve).not.toHaveBeenCalled();
  });
  it("registration cleanup is identity-owned and disposal revokes callbacks", async () => {
    const s = setup(); const old = s.coordinator.register("a", s.a.p); s.coordinator.register("a", s.a.p); old();
    await s.coordinator.request(); await s.coordinator.saveAll(); expect(s.approve).toHaveBeenCalledOnce();
    const t = setup(); t.coordinator.dispose(); await t.coordinator.request(); await t.coordinator.discard(); expect(t.approve).not.toHaveBeenCalled();
  });
  it("native or sidecar failure leaves a retryable visible prompt", async () => {
    const s = setup(); s.approve.mockRejectedValueOnce(new Error("native denied"));
    await s.coordinator.request(); await s.coordinator.saveAll(); expect(s.coordinator.state).toMatchObject({ phase: "prompt", error: expect.stringContaining("native denied") });
    await s.coordinator.saveAll(); expect(s.approve).toHaveBeenCalledTimes(2);
    const t = setup(); t.flush.mockRejectedValueOnce(new Error("disk full")); await t.coordinator.request(); await t.coordinator.discard(); expect(t.approve).not.toHaveBeenCalled();
  });
});
