import { describe, expect, it, vi } from "vitest";
import { DocumentCloseLifecycle, type CloseSnapshot } from "./close_lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(dirty = true) {
  const state: CloseSnapshot = { generation: 1, revision: 1, version: 1, dirty, busy: false, canSave: true };
  const saved = deferred<boolean>();
  const save = vi.fn(() => saved.promise);
  const remove = vi.fn();
  const changed = vi.fn();
  const close = new DocumentCloseLifecycle(() => state, save, remove, changed);
  return { state, saved, save, remove, changed, close };
}

describe("document close decisions", () => {
  it("approves an idle clean document exactly once", () => {
    const t = setup(false); t.close.request(); t.close.request(); t.close.discard();
    expect(t.remove).toHaveBeenCalledTimes(1); expect(t.save).not.toHaveBeenCalled();
  });
  it("keeps dirty buffers with one persistent prompt and Cancel revokes it", () => {
    const t = setup(); t.close.request(); const prompt = t.close.state; t.close.request();
    expect(t.close.state).toBe(prompt); expect(t.remove).not.toHaveBeenCalled();
    t.close.cancel(); expect(t.close.state).toBeNull(); expect(t.state.dirty).toBe(true);
  });
  it("explicit Discard approves removal without writing", () => {
    const t = setup(); t.close.request(); t.close.discard();
    expect(t.remove).toHaveBeenCalledOnce(); expect(t.save).not.toHaveBeenCalled();
  });
  it("uses normal save and approves only its successful clean result", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    expect(t.close.state?.saving).toBe(true); t.state.dirty = false; t.saved.resolve(true); await pending;
    expect(t.save).toHaveBeenCalledOnce(); expect(t.remove).toHaveBeenCalledOnce();
  });
  it.each(["I/O failure", "conflict", "missing target"])("keeps the prompt after %s", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.saved.resolve(false); await pending;
    expect(t.remove).not.toHaveBeenCalled(); expect(t.close.state?.message).toMatch(/could not save/i);
    expect(t.close.state?.saving).toBe(false);
  });
  it("retains errors thrown by save in persistent feedback", async () => {
    const t = setup(); const close = new DocumentCloseLifecycle(() => t.state, async () => { throw new Error("disk full"); }, t.remove, t.changed);
    close.request(); await close.saveAndClose();
    expect(close.state?.message).toContain("disk full"); expect(t.remove).not.toHaveBeenCalled();
  });
  it("keeps open when newer edits occurred even if another save made them clean", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.state.version++; t.state.dirty = false; t.saved.resolve(true); await pending;
    expect(t.remove).not.toHaveBeenCalled(); expect(t.close.state?.message).toMatch(/newer edits/i);
  });
  it("deduplicates requests and save decisions while pending", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.close.request(); await t.close.saveAndClose(); expect(t.save).toHaveBeenCalledOnce();
    t.state.dirty = false; t.saved.resolve(true); await pending; expect(t.remove).toHaveBeenCalledOnce();
  });
  it("Cancel during save revokes removal even after a subsequent close request", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.close.cancel(); t.close.request(); const current = t.close.state;
    t.state.dirty = false; t.saved.resolve(true); await pending;
    expect(t.remove).not.toHaveBeenCalled(); expect(t.close.state).toBe(current);
  });
  it("Discard during save removes once and ignores its completion", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.close.discard(); t.state.dirty = false; t.saved.resolve(true); await pending;
    expect(t.remove).toHaveBeenCalledTimes(1);
  });
  it.each(["creation", "ordinary save", "AI"])("prompts for clean documents during %s and refuses save while busy", async () => {
    const t = setup(false); t.state.busy = true; t.close.request(); await t.close.saveAndClose();
    expect(t.close.state).not.toBeNull(); expect(t.save).not.toHaveBeenCalled(); expect(t.remove).not.toHaveBeenCalled();
    t.close.cancel(); expect(t.close.state).toBeNull();
  });
  it("keeps missing documents open without silently recreating them", async () => {
    const t = setup(); t.state.canSave = false; t.close.request(); await t.close.saveAndClose();
    expect(t.save).not.toHaveBeenCalled(); expect(t.remove).not.toHaveBeenCalled();
  });
  it.each(["generation", "revision"] as const)("rejects stale %s completion", async (field) => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.state[field]++; t.state.dirty = false; t.saved.resolve(true); await pending; expect(t.remove).not.toHaveBeenCalled();
  });
  it("an unmounted lifetime ignores completion and old registered requests", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose(); t.close.dispose();
    t.close.request(); t.close.discard(); t.state.dirty = false; t.saved.resolve(true); await pending;
    expect(t.remove).not.toHaveBeenCalled();
  });
  it("does not close if another operation begins while saving", async () => {
    const t = setup(); t.close.request(); const pending = t.close.saveAndClose();
    t.state.dirty = false; t.state.busy = true; t.saved.resolve(true); await pending;
    expect(t.remove).not.toHaveBeenCalled(); expect(t.close.state?.message).toMatch(/operation/i);
  });
});
