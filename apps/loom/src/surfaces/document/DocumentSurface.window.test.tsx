import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { CreateEditorArgs } from "./editor";
import type { AiEvent } from "./ai_ipc";
import type { Event as LoomEvent } from "../../contracts/Event";
import { DocumentSurface } from "./DocumentSurface";
import type { WindowCloseParticipant as Participant } from "./window_participant";

// The project has no DOM test dependency. This hook host runs the real surface
// and its effects, JSX handlers, editor callbacks and IPC boundaries in Node.
// DOM focus and browser propagation are independently checked in Chromium.
const host = vi.hoisted(() => ({
  cells: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
  cursor: 0,
  effects: [] as (() => void)[],
  dirty: false,
  text: "",
  editor: null as CreateEditorArgs | null,
  aiEvent: null as ((event: AiEvent) => void) | null,
  fsEvent: null as ((event: LoomEvent) => void) | null,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef(value: unknown) {
    const index = host.cursor++;
    host.cells[index] ??= { value: { current: value } };
    return host.cells[index]!.value;
  },
  useState(initial: unknown) {
    const index = host.cursor++;
    host.cells[index] ??= { value: initial };
    return [host.cells[index]!.value, (next: unknown) => {
      host.cells[index]!.value = typeof next === "function" ? next(host.cells[index]!.value) : next;
      host.dirty = true;
    }];
  },
  useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
    const index = host.cursor++;
    const cell = host.cells[index] ??= {};
    if (cell.deps && cell.deps.length === deps.length && deps.every((dep, n) => Object.is(dep, cell.deps![n]))) return;
    cell.deps = deps;
    host.effects.push(() => { cell.cleanup?.(); cell.cleanup = effect() || undefined; });
  },
}));
vi.mock("./editor", () => ({
  createEditor: vi.fn((options: CreateEditorArgs) => {
    host.editor = options; host.text = options.initialContent;
    return {
      view: { state: { doc: { toString: () => host.text, get length() { return host.text.length; } } } },
      replaceDoc: (text: string) => { host.text = text; },
      insertAtCursor: (text: string) => { host.text += text; options.onChange(host.text); },
      destroy: vi.fn(), appendOutput: vi.fn(), clearOutput: vi.fn(),
    };
  }),
}));
vi.mock("./doc_ipc", () => ({
  docRead: vi.fn(), docWrite: vi.fn(), docCreate: vi.fn(),
  docOpen: vi.fn().mockResolvedValue(undefined), docClose: vi.fn().mockResolvedValue(undefined),
  docMarkDirty: vi.fn().mockResolvedValue(undefined), docMarkClean: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./ai_ipc", () => ({
  aiStatus: vi.fn().mockResolvedValue({ provider: "mock", model: "mock", key_present: true, key_env: "MOCK" }),
  onAiEvent: vi.fn(async (callback: (event: AiEvent) => void) => { host.aiEvent = callback; return vi.fn(); }),
  aiAsk: vi.fn(), aiCancel: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../ipc", () => ({
  onPtyIo: vi.fn().mockResolvedValue(vi.fn()),
  onLoomEvent: vi.fn(async (callback: (event: LoomEvent) => void) => { host.fsEvent = callback; return vi.fn(); }),
  ptyScrollback: vi.fn(), writeStdin: vi.fn(),
}));
import * as doc from "./doc_ipc";
import * as ai from "./ai_ipc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
type Element = ReactElement<Record<string, any>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node && typeof node === "object" && "props" in node) return text((node as Element).props.children);
  return "";
}
function mount() {
  const remove = vi.fn();
  const unregister = vi.fn();
  let participant: Participant | undefined;
  const register = vi.fn((value: Participant) => { participant = value; return unregister; });
  let props = { path: "notes.md", onClose: remove, registerWindowCloseParticipant: register, activeTerminalId: null };
  let tree: Element;
  const render = (flushEffects = true) => {
    let attempts = 0;
    do {
      host.cursor = 0; host.dirty = false;
      tree = DocumentSurface(props);
      for (const el of elements(tree)) {
        const ref = (el as unknown as { ref?: { current: unknown } }).ref;
        if (ref && ref.current === null) ref.current = { focus: vi.fn() };
      }
      if (flushEffects) for (const effect of host.effects.splice(0)) effect();
      if (++attempts > 20) throw new Error("Unstable test hook host");
    } while (flushEffects && host.dirty);
  };
  const flush = async () => { for (let n = 0; n < 25; n++) { await Promise.resolve(); render(); } };
  const button = (label: string) => {
    render();
    const found = elements(tree).find((el) => el.type === "button" && text(el.props.children) === label);
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  const click = (label: string) => { const target = button(label); expect(target.props.disabled).not.toBe(true); target.props.onClick(); render(); };
  render();
  return { remove, unregister, register, flush, click,
    participant: () => { expect(participant).toBeDefined(); return participant!; },
    edit: (next: string) => { host.text = next; host.editor!.onChange(next); render(); },
    replaceBeforeCleanup: (path: string) => { props = { ...props, path }; render(false); },
    replace: (path: string) => { props = { ...props, path }; render(); },
    setRegisterBeforeCleanup: (next: typeof register) => { props = { ...props, registerWindowCloseParticipant: next }; render(false); },
    detachBeforeCleanup: () => { (tree as unknown as { ref: (node: null) => void }).ref(null); },
    root: () => { render(); return tree; },
  };
}
beforeEach(() => {
  host.cells = []; host.cursor = 0; host.effects = []; host.dirty = false;
  host.editor = null; host.aiEvent = null; host.fsEvent = null;
  vi.clearAllMocks();
  vi.mocked(doc.docRead).mockResolvedValue({ path: "/vault/notes.md", content: "old", on_disk_hash: "h1" });
  vi.mocked(doc.docWrite).mockResolvedValue({ kind: "written", new_hash: "h2" });
  vi.mocked(doc.docOpen).mockResolvedValue(undefined);
  vi.mocked(doc.docCreate).mockReset();
  vi.stubGlobal("window", { setTimeout: vi.fn() });
});
afterEach(() => { host.cells.forEach((cell) => cell.cleanup?.()); vi.unstubAllGlobals(); });

describe("DocumentSurface window participant", () => {
  it("registers unready then snapshots editor revisions and saves without removal", async () => {
    const t = mount(); const p = t.participant(); expect(p.snapshot()).toBeNull();
    await t.flush(); const initial = p.snapshot()!;
    expect(initial).toMatchObject({ dirty: false, busy: false, canSave: true });
    t.edit("current bytes"); const edited = p.snapshot()!;
    expect(edited.dirty).toBe(true); expect(edited.revision).not.toBe(initial.revision);
    expect(await p.save()).toBe(true); await t.flush();
    expect(doc.docWrite).toHaveBeenCalledWith("/vault/notes.md", "current bytes", "h1");
    expect(p.snapshot()).toEqual({ ...edited, dirty: false }); expect(t.remove).not.toHaveBeenCalled();
  });
  it("blocks duplicate participant saves immediately and keeps newer edits dirty", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("submitted"); const p = t.participant(); const before = p.snapshot()!;
    const saving = p.save(); expect(p.snapshot()!.busy).toBe(true); expect(await p.save()).toBe(false);
    await t.flush(); t.edit("later edits"); disk.resolve({ kind: "written", new_hash: "h2" });
    expect(await saving).toBe(true); await t.flush();
    expect(p.snapshot()!.revision).not.toBe(before.revision); expect(p.snapshot()!.dirty).toBe(true);
    expect(doc.docWrite).toHaveBeenCalledOnce(); expect(t.remove).not.toHaveBeenCalled();
  });
  it("includes ordinary toolbar saves in its busy state without extra writes", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("local"); const p = t.participant(); t.click("save");
    expect(p.snapshot()!.busy).toBe(true); expect(await p.save()).toBe(false);
    disk.resolve({ kind: "written", new_hash: "h2" }); await t.flush();
    expect(p.snapshot()).toMatchObject({ dirty: false, busy: false }); expect(doc.docWrite).toHaveBeenCalledOnce();
  });
  it("remains busy through metadata acknowledgement and reports acknowledgement failure", async () => {
    const t = mount(); await t.flush(); t.edit("local"); const metadata = deferred<void>();
    vi.mocked(doc.docOpen).mockReturnValueOnce(metadata.promise);
    const p = t.participant(); const saving = p.save(); await t.flush();
    expect(p.snapshot()!.busy).toBe(true); expect(t.remove).not.toHaveBeenCalled();
    metadata.reject(new Error("metadata failed")); expect(await saving).toBe(false); await t.flush();
    expect(p.snapshot()).toMatchObject({ dirty: true, busy: false, canSave: true }); expect(text(t.root())).toContain("metadata failed");
    expect(await p.save()).toBe(true); await t.flush();
    expect(p.snapshot()).toMatchObject({ dirty: false, busy: false }); expect(doc.docWrite).toHaveBeenCalledTimes(2);
  });
  it.each(["not found", "disk full"])("returns false for %s without recreation or removal", async (failure) => {
    vi.mocked(doc.docWrite).mockRejectedValue(new Error(failure));
    const t = mount(); await t.flush(); t.edit("local"); expect(await t.participant().save()).toBe(false); await t.flush();
    expect(t.participant().snapshot()!.dirty).toBe(true); expect(doc.docCreate).not.toHaveBeenCalled(); expect(t.remove).not.toHaveBeenCalled();
  });
  it("requires Keep for a watcher conflict before window save even when disk bytes revert", async () => {
    const t = mount(); await t.flush(); t.edit("local"); const p = t.participant();
    vi.mocked(doc.docRead).mockResolvedValue({ path: "/vault/notes.md", content: "external", on_disk_hash: "external" });
    await host.fsEvent!({ kind: "fs_changed", path: "/vault/notes.md", change: { kind: "modified" } });
    expect(p.snapshot()!.canSave).toBe(false); // Effective before a state render.
    await t.flush();
    // Disk reverted to h1: the old automatic expected hash would now succeed.
    vi.mocked(doc.docWrite).mockImplementation(async (_path, _content, expected) => expected === "h1"
      ? { kind: "written", new_hash: "h2" } : { kind: "conflict", current_disk_hash: "h1" });
    expect(p.snapshot()).toMatchObject({ dirty: true, busy: false, canSave: false });
    expect(await p.save()).toBe(false); expect(doc.docWrite).not.toHaveBeenCalled();
    const keep = () => elements(t.root()).find((el) => el.type === "button" && /keep/i.test(text(el.props.children)))!.props.onClick();
    keep(); expect(p.snapshot()!.canSave).toBe(true);
    expect(await p.save()).toBe(false); await t.flush();
    expect(doc.docWrite).toHaveBeenNthCalledWith(1, "/vault/notes.md", "local", "external");
    expect(p.snapshot()!.canSave).toBe(false); keep();
    expect(await p.save()).toBe(true); await t.flush();
    expect(doc.docWrite).toHaveBeenNthCalledWith(2, "/vault/notes.md", "local", "h1"); expect(t.remove).not.toHaveBeenCalled();
  });
  it("preserves optimistic conflict and supports ordinary confirmed retry", async () => {
    vi.mocked(doc.docWrite).mockResolvedValueOnce({ kind: "conflict", current_disk_hash: "external" });
    const t = mount(); await t.flush(); t.edit("local"); const p = t.participant(); expect(await p.save()).toBe(false); await t.flush();
    const keep = elements(t.root()).find((el) => el.type === "button" && /keep/i.test(text(el.props.children)))!;
    keep.props.onClick(); expect(await p.save()).toBe(true); await t.flush();
    expect(doc.docWrite).toHaveBeenNthCalledWith(2, "/vault/notes.md", "local", "external"); expect(t.remove).not.toHaveBeenCalled();
  });
  it("protects missing files across complete create metadata acknowledgement", async () => {
    vi.mocked(doc.docRead).mockRejectedValue(new Error("not found"));
    const t = mount(); await t.flush(); const p = t.participant(); expect(p.snapshot()!.canSave).toBe(false); expect(await p.save()).toBe(false);
    const metadata = deferred<void>(); vi.mocked(doc.docOpen).mockReturnValueOnce(metadata.promise);
    vi.mocked(doc.docCreate).mockResolvedValue({ path: "/vault/notes.md", content: "", on_disk_hash: "created" });
    t.click("create empty file"); expect(p.snapshot()!.busy).toBe(true); await t.flush(); expect(p.snapshot()!.busy).toBe(true);
    metadata.resolve(); await t.flush(); expect(p.snapshot()).toMatchObject({ busy: false, canSave: true }); expect(t.remove).not.toHaveBeenCalled();
  });
  it("reports AI submission and streaming as busy and revokes it on completion", async () => {
    const request = deferred<string>(); vi.mocked(ai.aiAsk).mockReturnValue(request.promise);
    const t = mount(); await t.flush(); const p = t.participant(); t.click("🤖 ask AI");
    const textarea = elements(t.root()).find((el) => el.type === "textarea")!;
    textarea.props.onChange({ target: { value: "help" } }); t.click("send (⌘↵)");
    expect(p.snapshot()!.busy).toBe(true); expect(await p.save()).toBe(false);
    await t.flush(); request.resolve("request-1"); await t.flush(); expect(p.snapshot()!.busy).toBe(true);
    host.aiEvent!({ kind: "done", request_id: "request-1", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    await t.flush(); expect(p.snapshot()).toMatchObject({ dirty: true, busy: false }); expect(t.remove).not.toHaveBeenCalled();
  });
  it("revokes stale snapshots and save callbacks at replacement render before passive cleanup", async () => {
    const t = mount(); await t.flush(); t.edit("old"); const p = t.participant(); t.replaceBeforeCleanup("other.md");
    expect(t.unregister).not.toHaveBeenCalled(); expect(p.snapshot()).toBeNull(); expect(await p.save()).toBe(false);
    expect(doc.docWrite).not.toHaveBeenCalled(); await t.flush(); expect(t.unregister).toHaveBeenCalledOnce();
    expect(t.participant()).not.toBe(p); expect(t.participant().snapshot()).not.toBeNull();
  });
  it("rejects an old save completion after replacement render before passive cleanup", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("old"); const p = t.participant(); const saving = p.save(); await t.flush();
    t.replaceBeforeCleanup("other.md"); disk.resolve({ kind: "written", new_hash: "h2" });
    expect(await saving).toBe(false); expect(p.snapshot()).toBeNull(); expect(t.remove).not.toHaveBeenCalled();
  });
  it("revokes registration replacement before its old cleanup and owns cleanup identity", async () => {
    const t = mount(); await t.flush(); const p = t.participant(); const unregister = vi.fn();
    const next = vi.fn((_p: Participant) => unregister); t.setRegisterBeforeCleanup(next);
    expect(t.unregister).not.toHaveBeenCalled(); expect(p.snapshot()).toBeNull(); expect(await p.save()).toBe(false);
    await t.flush(); expect(t.unregister).toHaveBeenCalledOnce(); expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]![0].snapshot()).not.toBeNull(); expect(unregister).not.toHaveBeenCalled();
  });
  it("revokes an unmounted participant at DOM detach before passive cleanup", async () => {
    const t = mount(); await t.flush(); t.edit("local"); const p = t.participant(); t.detachBeforeCleanup();
    expect(t.unregister).not.toHaveBeenCalled(); expect(p.snapshot()).toBeNull(); expect(await p.save()).toBe(false); expect(doc.docWrite).not.toHaveBeenCalled();
  });
  it("rejects pending save completion after DOM detach before passive cleanup", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("local"); const p = t.participant(); const saving = p.save(); await t.flush();
    t.detachBeforeCleanup(); disk.resolve({ kind: "written", new_hash: "h2" });
    expect(await saving).toBe(false); expect(p.snapshot()).toBeNull(); expect(t.remove).not.toHaveBeenCalled();
  });
  it("changes revision on external reload and exposes failed loading as unready", async () => {
    const t = mount(); await t.flush(); const p = t.participant(); const before = p.snapshot()!.revision;
    vi.mocked(doc.docRead).mockResolvedValue({ path: "/vault/notes.md", content: "external", on_disk_hash: "h3" });
    await host.fsEvent!({ kind: "fs_changed", path: "/vault/notes.md", change: { kind: "modified" } }); await t.flush();
    expect(p.snapshot()!.revision).not.toBe(before); expect(p.snapshot()!.dirty).toBe(false);
    vi.mocked(doc.docRead).mockRejectedValue(new Error("permission denied")); t.replace("bad.md"); await t.flush(); expect(t.participant().snapshot()).toBeNull();
  });
});
