import { describe, expect, it, vi } from "vitest";
import { DocumentLifecycle, DocumentReadGate, createMissingDocument } from "./lifecycle";
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
  it("recreates a deleted dirty document with its current buffer and preserves other documents", async () => {
    const other = opened(); other.edit();
    const target = opened(); target.edit();
    const write = vi.fn(async (_path: string, _content: string, _hash: string | null): Promise<WriteOutcome> => ({ kind: "written", new_hash: "recreated" }));
    const read = vi.fn(async (path: string) => ({ path, content: "unsaved target", on_disk_hash: "recreated" }));
    const snapshot = await createMissingDocument(target.path, "unsaved target", write, read);
    target.load(snapshot);
    expect(write).toHaveBeenCalledWith(target.path, "unsaved target", null);
    expect(target.dirty).toBe(false);
    expect(other.dirty).toBe(true);
    expect(other.hash).toBe("h1");
    expect(read).toHaveBeenCalledTimes(1);
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
