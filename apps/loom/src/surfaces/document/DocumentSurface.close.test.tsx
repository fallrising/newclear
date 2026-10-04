import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactElement } from "react";
import type { CreateEditorArgs } from "./editor";
import type { AiEvent } from "./ai_ipc";
import type { Event as LoomEvent } from "../../contracts/Event";
import { DocumentSurface } from "./DocumentSurface";

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
  let guard!: () => void;
  const register = vi.fn((request: () => void) => { guard = request; return unregister; });
  let props: ComponentProps<typeof DocumentSurface> = { path: "notes.md", onClose: remove, registerCloseGuard: register, activeTerminalId: null };
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
  const prompt = () => { render(); return elements(tree).find((el) => el.props.role === "alertdialog"); };
  const edit = (next: string) => { host.text = next; host.editor!.onChange(next); render(); };
  render();
  return { remove, unregister, register, guard: () => guard(), flush, button, click, prompt, edit,
    replace: (path: string) => { props = { ...props, path }; render(); },
    replaceBeforeCleanup: (path: string, onClose: () => void) => { props = { ...props, path, onClose }; render(false); },
    settleBeforeCleanup: async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); },
    setRegister: (next: typeof register) => { props = { ...props, registerCloseGuard: next }; render(); },
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
  vi.stubGlobal("window", { setTimeout: vi.fn() });
});
afterEach(() => { host.cells.forEach((cell) => cell.cleanup?.()); vi.unstubAllGlobals(); });

describe("DocumentSurface close integration", () => {
  it("shares the toolbar and registered guard and keeps Cancel non-destructive", async () => {
    const t = mount(); await t.flush(); t.edit("local"); t.click("close"); t.guard();
    expect(t.prompt()).toBeDefined(); expect(t.remove).not.toHaveBeenCalled();
    t.click("Cancel"); expect(t.prompt()).toBeUndefined(); expect(host.text).toBe("local");
    t.guard(); t.click("Discard changes"); expect(t.remove).toHaveBeenCalledOnce(); expect(doc.docWrite).not.toHaveBeenCalled();
  });
  it("closes a clean idle document directly without a write", async () => {
    const t = mount(); await t.flush(); t.guard();
    expect(t.remove).toHaveBeenCalledOnce(); expect(doc.docWrite).not.toHaveBeenCalled();
  });
  it("saves current editor bytes with the optimistic hash before approved removal", async () => {
    const t = mount(); await t.flush(); t.edit("new bytes"); t.click("close"); t.click("Save and close"); await t.flush();
    expect(doc.docWrite).toHaveBeenCalledWith("/vault/notes.md", "new bytes", "h1"); expect(t.remove).toHaveBeenCalledOnce();
  });
  it("preserves newer typing and deduplicates requests during a pending save", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("submitted"); t.guard(); t.click("Save and close"); await t.flush();
    expect(t.button("Save and close").props.disabled).toBe(true); expect(t.button("Cancel").props.disabled).not.toBe(true);
    t.guard(); t.click("close"); t.edit("typed later"); disk.resolve({ kind: "written", new_hash: "h2" }); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(doc.docWrite).toHaveBeenCalledOnce(); expect(text(t.prompt())).toMatch(/newer edits/i);
  });
  it("Cancel during a pending save revokes the close decision", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("submitted"); t.guard(); t.click("Save and close"); t.click("Cancel");
    disk.resolve({ kind: "written", new_hash: "h2" }); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(t.prompt()).toBeUndefined();
  });
  it.each(["disk full", "not found"])("keeps persistent feedback for %s without creating a file", async (failure) => {
    vi.mocked(doc.docWrite).mockRejectedValue(new Error(failure));
    const t = mount(); await t.flush(); t.edit("local"); t.guard(); t.click("Save and close"); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(text(t.prompt())).toContain(failure); expect(doc.docCreate).not.toHaveBeenCalled();
  });
  it("conflict stays open and Keep authorizes the observed hash for one retry", async () => {
    vi.mocked(doc.docWrite).mockResolvedValueOnce({ kind: "conflict", current_disk_hash: "external" }).mockResolvedValue({ kind: "written", new_hash: "h3" });
    const t = mount(); await t.flush(); t.edit("local"); t.guard(); t.click("Save and close"); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(t.prompt()).toBeDefined();
    // Locate the actual conflict control through the rendered JSX.
    const keep = elements(t.root()).find((el) => el.type === "button" && /keep/i.test(text(el.props.children)));
    expect(keep).toBeDefined(); keep!.props.onClick(); t.click("Save and close"); await t.flush();
    expect(doc.docWrite).toHaveBeenNthCalledWith(2, "/vault/notes.md", "local", "external"); expect(t.remove).toHaveBeenCalledOnce();
  });
  it("ordinary save is busy from the initiating event and cannot auto-close", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.click("save"); t.guard();
    expect(t.prompt()).toBeDefined(); expect(t.button("Save and close").props.disabled).toBe(true); expect(t.remove).not.toHaveBeenCalled();
    disk.resolve({ kind: "written", new_hash: "h2" }); await t.flush(); expect(t.remove).not.toHaveBeenCalled();
  });
  it("holds close protection through delayed save metadata synchronization and failure", async () => {
    const metadata = deferred<void>();
    const t = mount(); await t.flush();
    vi.mocked(doc.docOpen).mockReturnValueOnce(metadata.promise);
    t.edit("local"); t.click("save"); await t.flush();
    t.guard(); expect(t.prompt()).toBeDefined();
    expect(t.button("Save and close").props.disabled).toBe(true); expect(t.remove).not.toHaveBeenCalled();
    metadata.reject(new Error("metadata acknowledgement failed")); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(text(t.prompt())).toContain("metadata acknowledgement failed");
    expect(t.button("Save and close").props.disabled).toBe(false);
  });
  it("holds a Save and close decision through delayed metadata failure", async () => {
    const metadata = deferred<void>(); const t = mount(); await t.flush();
    vi.mocked(doc.docOpen).mockReturnValueOnce(metadata.promise);
    t.edit("local"); t.guard(); t.click("Save and close"); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(t.button("Cancel").props.disabled).not.toBe(true);
    metadata.reject(new Error("state unavailable")); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(text(t.prompt())).toContain("state unavailable");
  });
  it("keeps a clean missing document during pending creation and permits explicit Discard", async () => {
    vi.mocked(doc.docRead).mockRejectedValue(new Error("not found"));
    const disk = deferred<doc.DocSnapshot>(); vi.mocked(doc.docCreate).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.click("create empty file"); t.guard();
    expect(t.prompt()).toBeDefined(); expect(t.button("Save and close").props.disabled).toBe(true);
    t.click("Discard changes"); expect(t.remove).toHaveBeenCalledOnce();
    disk.resolve({ path: "/vault/notes.md", content: "", on_disk_hash: "created" }); await t.flush(); expect(t.remove).toHaveBeenCalledOnce();
  });
  it("holds close protection through delayed creation metadata synchronization", async () => {
    vi.mocked(doc.docRead).mockRejectedValue(new Error("not found"));
    vi.mocked(doc.docCreate).mockResolvedValue({ path: "/vault/notes.md", content: "", on_disk_hash: "created" });
    const metadata = deferred<void>(); vi.mocked(doc.docOpen).mockReturnValueOnce(metadata.promise);
    const t = mount(); await t.flush(); t.click("create empty file"); await t.flush(); t.guard();
    expect(t.prompt()).toBeDefined(); expect(t.button("Save and close").props.disabled).toBe(true); expect(t.remove).not.toHaveBeenCalled();
    metadata.resolve(); await t.flush(); expect(t.remove).not.toHaveBeenCalled(); expect(t.button("Save and close").props.disabled).toBe(false);
  });
  it("AI submission protects even a clean buffer and unmount preserves AI cancellation", async () => {
    const request = deferred<string>(); vi.mocked(ai.aiAsk).mockReturnValue(request.promise);
    const t = mount(); await t.flush(); t.click("🤖 ask AI");
    const textarea = elements(t.root()).find((el) => el.type === "textarea")!;
    textarea.props.onChange({ target: { value: "help" } }); t.click("send (⌘↵)"); t.guard();
    expect(t.prompt()).toBeDefined(); expect(t.button("Save and close").props.disabled).toBe(true); expect(t.remove).not.toHaveBeenCalled();
    await t.flush(); request.resolve("request-1"); await t.flush(); t.replace("other.md"); await t.flush();
    expect(ai.aiCancel).toHaveBeenCalledWith("request-1");
  });
  it("replaces registration safely and stale lifetimes cannot remove another document", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); const oldGuard = t.register.mock.calls[0]![0];
    const secondCleanup = vi.fn(); const nextRegister = vi.fn((_request: () => void) => secondCleanup);
    t.setRegister(nextRegister); expect(t.unregister).toHaveBeenCalledOnce(); expect(nextRegister).toHaveBeenCalledOnce();
    t.edit("old"); t.guard(); t.click("Save and close"); await t.flush(); t.replace("other.md"); await t.flush();
    oldGuard(); disk.resolve({ kind: "written", new_hash: "h2" }); await t.flush();
    expect(t.remove).not.toHaveBeenCalled(); expect(t.prompt()).toBeUndefined(); expect(secondCleanup).toHaveBeenCalledOnce();
  });
  it("rejects old save completion after replacement render before passive cleanup", async () => {
    const disk = deferred<doc.WriteOutcome>(); vi.mocked(doc.docWrite).mockReturnValue(disk.promise);
    const t = mount(); await t.flush(); t.edit("old bytes"); t.guard(); t.click("Save and close"); await t.flush();
    const replacementRemove = vi.fn(); t.replaceBeforeCleanup("other.md", replacementRemove);
    expect(t.unregister).not.toHaveBeenCalled(); expect(host.effects.length).toBeGreaterThan(0);
    disk.resolve({ kind: "written", new_hash: "h2" }); await t.settleBeforeCleanup();
    expect(t.remove).not.toHaveBeenCalled(); expect(replacementRemove).not.toHaveBeenCalled();
    await t.flush(); t.guard(); expect(replacementRemove).toHaveBeenCalledOnce();
  });
  it("rejects an old registered clean close request before passive cleanup", async () => {
    const t = mount(); await t.flush(); const oldGuard = t.register.mock.calls[0]![0];
    const replacementRemove = vi.fn(); t.replaceBeforeCleanup("other.md", replacementRemove); oldGuard();
    expect(t.unregister).not.toHaveBeenCalled(); expect(t.remove).not.toHaveBeenCalled(); expect(replacementRemove).not.toHaveBeenCalled();
  });
  it("rejects old Discard before passive cleanup", async () => {
    const t = mount(); await t.flush(); t.edit("old bytes"); t.guard(); const oldDiscard = t.button("Discard changes").props.onClick;
    const replacementRemove = vi.fn(); t.replaceBeforeCleanup("other.md", replacementRemove); oldDiscard();
    expect(t.unregister).not.toHaveBeenCalled(); expect(t.remove).not.toHaveBeenCalled(); expect(replacementRemove).not.toHaveBeenCalled();
  });
  it("rejects an old Save and close decision before passive cleanup", async () => {
    const t = mount(); await t.flush(); t.edit("old bytes"); t.guard(); const oldSave = t.button("Save and close").props.onClick;
    const replacementRemove = vi.fn(); t.replaceBeforeCleanup("other.md", replacementRemove); oldSave(); await t.settleBeforeCleanup();
    expect(t.unregister).not.toHaveBeenCalled(); expect(doc.docWrite).not.toHaveBeenCalled(); expect(replacementRemove).not.toHaveBeenCalled();
  });
  it.each(["Delete", "Backspace"])("keeps %s inside editor/prompt controls from reaching canvas", async (key) => {
    const t = mount(); await t.flush(); t.edit("local"); t.guard(); const stopPropagation = vi.fn();
    t.root().props.onKeyDown({ key, stopPropagation }); expect(stopPropagation).toHaveBeenCalledOnce(); expect(t.remove).not.toHaveBeenCalled();
  });
});
