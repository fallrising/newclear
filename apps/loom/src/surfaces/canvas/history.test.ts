import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../contracts/SessionMeta";
import type { SessionHistorySnapshot } from "../../ipc";
import { SessionHistoryController, eligibleForRecovery } from "./history";

const saved: SessionMeta = { id: "old", cwd: "/vault", cmd: "echo saved", shell: "/bin/sh", state: { kind: "tombstone", reason: "restart" }, last_activity_ms: 1n };
const snapshot = (sessions = [saved], live_session_ids: string[] = []): SessionHistorySnapshot => ({ sessions, live_session_ids, persistent: true, warning: null });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const controllers: SessionHistoryController[] = [];
afterEach(() => { controllers.forEach((controller) => controller.dispose()); controllers.length = 0; });
function fixture() {
  const off = vi.fn(); let notify!: () => void;
  const api = {
    listen: vi.fn(async (cb: () => void): Promise<() => void> => { notify = cb; return off; }),
    read: vi.fn(async () => snapshot()),
    restart: vi.fn(async () => "new"),
    forget: vi.fn(async () => undefined),
    meta: vi.fn(async () => ({ ...saved, id: "new", state: { kind: "active" } } as SessionMeta)),
    kill: vi.fn(async () => undefined),
  };
  const changed = vi.fn(); const attach = vi.fn(() => true);
  const controller = new SessionHistoryController(api, changed, attach);
  controllers.push(controller);
  return { api, off, notify: () => notify(), controller, changed, attach };
}

describe("session history lifecycle", () => {
  it("registers notifications before the initial read and never automatically restarts", async () => {
    const f = fixture(); const registration = deferred<() => void>(); f.api.listen.mockReturnValueOnce(registration.promise);
    const start = f.controller.start(); expect(f.api.read).not.toHaveBeenCalled();
    registration.resolve(f.off); await start;
    expect(f.controller.state.snapshot).toEqual(snapshot()); expect(f.api.restart).not.toHaveBeenCalled(); expect(f.attach).not.toHaveBeenCalled();
  });
  it("shows read failure and recovers on manual retry", async () => {
    const f = fixture(); f.api.read.mockRejectedValueOnce(new Error("unreadable")); await f.controller.start();
    expect(f.controller.state.error).toContain("unreadable"); await f.controller.refresh();
    expect(f.controller.state.error).toBeNull(); expect(f.controller.state.snapshot).toEqual(snapshot());
  });
  it("retries listener failure before allowing reads", async () => {
    const f = fixture(); f.api.listen.mockRejectedValueOnce(new Error("listener unavailable")); await f.controller.start();
    expect(f.api.read).not.toHaveBeenCalled(); expect(f.controller.state.error).toContain("listener unavailable");
    await f.controller.refresh(); expect(f.api.listen).toHaveBeenCalledTimes(2); expect(f.api.read).toHaveBeenCalledTimes(1);
  });
  it("refreshes on notifications and ignores out-of-order snapshots", async () => {
    const f = fixture(); await f.controller.start(); const old = deferred<ReturnType<typeof snapshot>>();
    f.api.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...snapshot(), persistent: false, warning: "disk full" });
    const pending = f.controller.refresh(); await Promise.resolve(); f.notify(); await new Promise((resolve) => setTimeout(resolve, 0));
    old.resolve(snapshot()); await pending;
    expect(f.controller.state.snapshot?.persistent).toBe(false); expect(f.controller.state.snapshot?.warning).toBe("disk full");
  });
  it("disposes late registration and ignores a late read", async () => {
    const f = fixture(); const registration = deferred<() => void>(); f.api.listen.mockReturnValueOnce(registration.promise);
    const start = f.controller.start(); f.controller.dispose(); registration.resolve(f.off); await start;
    expect(f.off).toHaveBeenCalledOnce(); expect(f.api.read).not.toHaveBeenCalled();
    const g = fixture(); const read = deferred<ReturnType<typeof snapshot>>(); g.api.read.mockReturnValueOnce(read.promise);
    const load = g.controller.start(); await Promise.resolve(); await Promise.resolve(); g.controller.dispose(); const count = g.changed.mock.calls.length;
    read.resolve(snapshot()); await load; expect(g.changed).toHaveBeenCalledTimes(count);
  });
  it("offers only exited/tombstone rows absent from the live manager", () => {
    expect(eligibleForRecovery(saved, snapshot())).toBe(true);
    expect(eligibleForRecovery(saved, snapshot([saved], [saved.id]))).toBe(false);
    expect(eligibleForRecovery({ ...saved, state: { kind: "active" } }, snapshot())).toBe(false);
    expect(eligibleForRecovery({ ...saved, state: { kind: "exited", code: 2 } }, snapshot())).toBe(true);
  });
  it("prevents duplicate restarts, preserves history, and attaches resolved metadata once", async () => {
    const f = fixture(); await f.controller.start(); const spawn = deferred<string>(); f.api.restart.mockReturnValueOnce(spawn.promise);
    const first = f.controller.restart(saved.id); await f.controller.restart(saved.id); await f.controller.forget(saved.id);
    expect(f.api.restart).toHaveBeenCalledTimes(1); expect(f.api.forget).not.toHaveBeenCalled();
    spawn.resolve("new"); await first;
    expect(f.attach).toHaveBeenCalledWith(expect.objectContaining({ id: "new", cwd: saved.cwd })); expect(f.api.kill).not.toHaveBeenCalled();
    expect(f.controller.state.snapshot?.sessions).toEqual([saved]); expect(f.controller.state.pending.size).toBe(0);
  });
  it.each(["cancel", "dispose", "reject attachment"])("cleans a restarted PTY on %s", async (reason) => {
    const f = fixture(); await f.controller.start(); const spawn = deferred<string>(); f.api.restart.mockReturnValueOnce(spawn.promise);
    const pending = f.controller.restart(saved.id);
    if (reason === "cancel") f.controller.cancel(saved.id); else if (reason === "dispose") f.controller.dispose(); else f.attach.mockReturnValueOnce(false);
    spawn.resolve("new"); await pending;
    expect(f.api.kill).toHaveBeenCalledWith("new"); if (reason !== "reject attachment") expect(f.attach).not.toHaveBeenCalled();
  });
  it("cleans metadata-fetch failure and exposes retryable restart/forget errors", async () => {
    const f = fixture(); await f.controller.start(); f.api.meta.mockRejectedValueOnce(new Error("metadata failed"));
    await f.controller.restart(saved.id); expect(f.api.kill).toHaveBeenCalledWith("new"); expect(f.controller.state.actionErrors.get(saved.id)).toContain("metadata failed");
    expect(f.controller.state.snapshot?.sessions).toEqual([saved]);
    f.api.forget.mockRejectedValueOnce(new Error("forget failed")); await f.controller.forget(saved.id);
    expect(f.controller.state.actionErrors.get(saved.id)).toContain("forget failed"); await f.controller.forget(saved.id);
    expect(f.controller.state.actionErrors.has(saved.id)).toBe(false); expect(f.attach).not.toHaveBeenCalled();
  });
  it("never acts on live rows and reports failed canceled cleanup for retry", async () => {
    const f = fixture(); f.api.read.mockResolvedValueOnce(snapshot([saved], [saved.id])); await f.controller.start();
    await f.controller.restart(saved.id); await f.controller.forget(saved.id); expect(f.api.restart).not.toHaveBeenCalled(); expect(f.api.forget).not.toHaveBeenCalled();
    await f.controller.refresh(); const spawn = deferred<string>(); f.api.restart.mockReturnValueOnce(spawn.promise); f.api.kill.mockRejectedValueOnce(new Error("kill failed"));
    const pending = f.controller.restart(saved.id); f.controller.cancel(saved.id); spawn.resolve("new"); await pending;
    expect(f.controller.state.cleanupErrors.get("new")).toContain("kill failed"); await f.controller.retryCleanup("new"); expect(f.controller.state.cleanupErrors.size).toBe(0);
  });
  it("keeps late unmounted cleanup failures visible when history mounts again", async () => {
    const f = fixture(); await f.controller.start(); const spawn = deferred<string>(); f.api.restart.mockReturnValueOnce(spawn.promise);
    const pending = f.controller.restart(saved.id); f.controller.dispose();
    const next = fixture(); await next.controller.start(); f.api.kill.mockRejectedValueOnce(new Error("late cleanup failed"));
    spawn.resolve("new"); await pending;
    expect(next.controller.state.cleanupErrors.get("new")).toContain("late cleanup failed");
    await next.controller.retryCleanup("new"); expect(next.controller.state.cleanupErrors.size).toBe(0); next.controller.dispose();
  });
});
