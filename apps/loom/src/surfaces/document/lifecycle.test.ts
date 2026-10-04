import { describe, expect, it, vi } from "vitest";
import { DocumentLifecycle, DocumentReadGate } from "./lifecycle";
import type { DocSnapshot, WriteOutcome } from "./doc_ipc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function opened() {
  const state = new DocumentLifecycle();
  state.load({ path: "/vault/notes.md", content: "old", on_disk_hash: "h1" });
  return state;
}
describe("document lifetime", () => {
  it("uses canonical IPC snapshot identity for relative-path watcher events", () => {
    expect(opened().path).toBe("/vault/notes.md");
  });
  it("reloads consecutive external snapshots without creating local edits", () => {
    const state = opened();
    state.load({ path: state.path, content: "external 1", on_disk_hash: "h2" });
    expect(state.dirty).toBe(false);
    state.load({ path: state.path, content: "external 2", on_disk_hash: "h3" });
    expect(state.dirty).toBe(false);
    expect(state.hash).toBe("h3");
  });
  it("retains edits made while a captured version saves", async () => {
    const state = opened(); state.edit();
    const disk = deferred<WriteOutcome>();
    const save = state.save(() => "saved v1", () => disk.promise);
    await Promise.resolve();
    state.edit(); disk.resolve({ kind: "written", new_hash: "h2" });
    await save;
    expect(state.dirty).toBe(true);
    expect(state.hash).toBe("h2");
  });
  it("serializes saves and captures the queued content and updated hash", async () => {
    const state = opened(); state.edit();
    let content = "first";
    const disk = deferred<WriteOutcome>();
    const write = vi.fn().mockImplementationOnce(() => disk.promise).mockResolvedValue({ kind: "written", new_hash: "h3" });
    const first = state.save(() => content, write);
    const second = state.save(() => content, write);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    content = "second"; state.edit(); disk.resolve({ kind: "written", new_hash: "h2" });
    await Promise.all([first, second]);
    expect(write.mock.calls).toEqual([[state.path, "first", "h1"], [state.path, "second", "h2"]]);
    expect(state.dirty).toBe(false);
  });
  it("Keep uses the observed hash once and a further disk change conflicts", async () => {
    const state = opened(); state.edit(); state.keep("observed");
    const write = vi.fn().mockResolvedValueOnce({ kind: "conflict", current_disk_hash: "newer" }).mockResolvedValue({ kind: "written", new_hash: "written" });
    await state.save(() => "local", write);
    expect(write).toHaveBeenNthCalledWith(1, state.path, "local", "observed");
    expect(state.dirty).toBe(true);
    await state.save(() => "local", write);
    expect(write).toHaveBeenNthCalledWith(2, state.path, "local", "h1");
  });
  it("successful Keep save becomes the next optimistic version", async () => {
    const state = opened(); state.keep("observed");
    const write = vi.fn().mockResolvedValue({ kind: "written", new_hash: "written" });
    await state.save(() => "local", write); state.edit();
    await state.save(() => "new local", write);
    expect(write).toHaveBeenNthCalledWith(1, state.path, "local", "observed");
    expect(write).toHaveBeenNthCalledWith(2, state.path, "new local", "written");
  });
  it("an older save response cannot replace a newly reloaded hash or dirty version", async () => {
    const state = opened(); state.edit();
    const disk = deferred<WriteOutcome>();
    const saving = state.save(() => "saved", () => disk.promise);
    await Promise.resolve();
    state.load({ path: state.path, content: "new disk snapshot", on_disk_hash: "newer" });
    disk.resolve({ kind: "written", new_hash: "older save" });
    await saving;
    expect(state.hash).toBe("newer");
    expect(state.dirty).toBe(false);
  });
  it("cancels queued saves after document disposal before reading a destroyed editor", async () => {
    const state = opened();
    const content = vi.fn(() => "never write empty destroyed-editor fallback");
    const write = vi.fn();
    const saving = state.save(content, write);
    state.close();
    await expect(saving).rejects.toThrow(/closed/);
    expect(content).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it("discards older overlapping reads and reads invalidated by a save", async () => {
    const gate = new DocumentReadGate(); const first = deferred<DocSnapshot>();
    const older = gate.read(() => first.promise);
    const current = { path: "/vault/doc.md", content: "new", on_disk_hash: "new" };
    expect(await gate.read(async () => current)).toEqual(current);
    first.resolve({ ...current, content: "old", on_disk_hash: "old" });
    expect(await older).toBeNull();
    const pending = deferred<DocSnapshot>(); const reading = gate.read(() => pending.promise);
    gate.invalidate(); pending.resolve(current);
    expect(await reading).toBeNull();
  });
  it("preserves typing during explicit recreation and saves against the created hash", async () => {
    const state = opened(); state.edit(); const savedVersion = state.version;
    state.edit();
    state.recreated({ path: state.path, content: "earlier captured bytes", on_disk_hash: "created" }, savedVersion);
    expect(state.dirty).toBe(true);
    const write = vi.fn().mockResolvedValue({ kind: "written", new_hash: "next" });
    await state.save(() => "latest input", write);
    expect(write).toHaveBeenCalledWith(state.path, "latest input", "created");
    expect(state.dirty).toBe(false);
  });
  it("failed I/O preserves dirty state and does not poison the serialized queue", async () => {
    const state = opened(); state.edit();
    const write = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue({ kind: "written", new_hash: "written" });
    await expect(state.save(() => "local", write)).rejects.toThrow("disk full");
    expect(state.dirty).toBe(true); expect(state.hash).toBe("h1");
    await state.save(() => "local", write);
    expect(write).toHaveBeenNthCalledWith(2, state.path, "local", "h1");
    expect(state.dirty).toBe(false);
  });
  it("invalidating a read after deletion suppresses a delayed snapshot", async () => {
    const gate = new DocumentReadGate(); const disk = deferred<DocSnapshot>();
    const reading = gate.read(() => disk.promise);
    gate.invalidate();
    disk.resolve({ path: "/vault/deleted.md", content: "before deletion", on_disk_hash: "before" });
    expect(await reading).toBeNull();
  });
  it("discards an obsolete read failure while preserving a current read failure", async () => {
    const gate = new DocumentReadGate(); let reject!: (error: Error) => void;
    const disk = new Promise<DocSnapshot>((_resolve, failed) => { reject = failed; });
    const reading = gate.read(() => disk); gate.invalidate(); reject(new Error("obsolete failure"));
    expect(await reading).toBeNull();
    await expect(gate.read(async () => { throw new Error("current failure"); })).rejects.toThrow("current failure");
  });
});


describe("create-only document lifetime", () => {
  const snapshot = { path: "/vault/notes.md", content: "submitted", on_disk_hash: "created" };
  it("creates only once while pending and acknowledges the submitted snapshot", async () => {
    const state = opened(); state.edit();
    const disk = deferred<DocSnapshot>();
    const create = vi.fn(() => disk.promise);
    const first = state.create("submitted", create);
    expect(state.creating).toBe(true);
    expect(await state.create("duplicate", create)).toBeNull();
    expect(create.mock.calls).toEqual([[state.path, "submitted"]]);
    disk.resolve(snapshot);
    expect(await first).toEqual(snapshot);
    expect(state.creating).toBe(false);
    expect(state.hash).toBe("created");
    expect(state.dirty).toBe(false);
  });
  it("retains newer edits and uses the submitted hash for the next save", async () => {
    const state = opened(); state.edit();
    const disk = deferred<DocSnapshot>();
    const creating = state.create("submitted", () => disk.promise);
    state.edit(); disk.resolve(snapshot); await creating;
    expect(state.dirty).toBe(true);
    const write = vi.fn().mockResolvedValue({ kind: "written", new_hash: "next" });
    await state.save(() => "typed while creating", write);
    expect(write).toHaveBeenCalledWith(state.path, "typed while creating", "created");
  });
  it("preserves failed dirty buffers, keeps an inline error, and permits retry", async () => {
    const state = opened(); state.edit();
    const create = vi.fn().mockRejectedValueOnce("Destination already exists; reload from disk").mockResolvedValue(snapshot);
    await expect(state.create("submitted", create)).rejects.toEqual("Destination already exists; reload from disk");
    expect(state.createError).toBe("Destination already exists; reload from disk");
    expect(state.creating).toBe(false);
    expect(state.dirty).toBe(true);
    expect(state.hash).toBe("h1");
    expect(await state.create("submitted", create)).toEqual(snapshot);
    expect(state.createError).toBeNull();
  });
  it("creates an initially missing document and enables subsequent saves", async () => {
    const state = new DocumentLifecycle(); state.missing("notes.md");
    expect(await state.create("", async () => ({ ...snapshot, content: "" }))).toEqual({ ...snapshot, content: "" });
    state.edit();
    const write = vi.fn().mockResolvedValue({ kind: "written", new_hash: "next" });
    await state.save(() => "new edit", write);
    expect(write).toHaveBeenCalledWith(snapshot.path, "new edit", "created");
  });
  it("never changes another document's dirty buffer", async () => {
    const other = opened(); other.edit(); const state = opened();
    await state.create("submitted", async () => snapshot);
    expect(other.dirty).toBe(true); expect(other.hash).toBe("h1");
  });
  it("keeps the duplicate gate during a pending create when reload is requested", async () => {
    const state = opened(); const disk = deferred<DocSnapshot>();
    const create = vi.fn(() => disk.promise);
    const pending = state.create("submitted", create);
    expect(state.invalidate()).toBe(false);
    expect(state.creating).toBe(true);
    expect(await state.create("second request", create)).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    disk.resolve(snapshot); await pending;
    expect(state.invalidate()).toBe(true);
  });
  it("clears invalidated save ownership after deletion and permits the next lifetime to save", async () => {
    const state = opened(); state.edit(); const disk = deferred<WriteOutcome>();
    const pending = state.save(() => "before deletion", () => disk.promise);
    await Promise.resolve(); expect(state.saving).toBe(true);
    state.invalidate(); expect(state.saving).toBe(false);
    state.load({ ...snapshot, on_disk_hash: "reloaded" }); state.edit();
    const write = vi.fn().mockResolvedValue({ kind: "written", new_hash: "newer" });
    const newer = state.save(() => "after reload", write);
    disk.resolve({ kind: "written", new_hash: "obsolete" }); await pending; await newer;
    expect(state.hash).toBe("newer"); expect(state.saving).toBe(false);
    expect(write).toHaveBeenCalledWith(state.path, "after reload", "reloaded");
  });
  it("ignores completion and finalizers from a closed and reopened lifetime", async () => {
    const state = opened(); const disk = deferred<DocSnapshot>();
    const old = state.create("old", () => disk.promise);
    state.close(); state.missing("new.md"); state.edit();
    const newerDisk = deferred<DocSnapshot>();
    const current = state.create("new", () => newerDisk.promise);
    disk.resolve(snapshot);
    expect(await old).toBeNull();
    expect(state.path).toBe("new.md"); expect(state.dirty).toBe(true);
    expect(state.creating).toBe(true);
    newerDisk.resolve({ ...snapshot, path: "/vault/new.md", content: "new" }); await current;
    expect(state.creating).toBe(false); expect(state.path).toBe("/vault/new.md");
  });
  it("ignores obsolete errors after explicit reload and clears current error", async () => {
    const state = opened(); let reject!: (reason: string) => void;
    const old = state.create("old", () => new Promise<DocSnapshot>((_resolve, failed) => { reject = failed; }));
    state.load({ ...snapshot, on_disk_hash: "external" });
    reject("obsolete failure"); expect(await old).toBeNull();
    expect(state.createError).toBeNull(); expect(state.hash).toBe("external");
    expect(state.dirty).toBe(false); expect(state.creating).toBe(false);
  });
});
