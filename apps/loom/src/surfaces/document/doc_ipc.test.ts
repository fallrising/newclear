import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import * as doc from "./doc_ipc";

describe("document create IPC", () => {
  beforeEach(() => { invoke.mockReset(); });
  it("uses create-only IPC and returns its submitted snapshot without reading disk", async () => {
    const snapshot = { path: "/vault/note.md", content: "submitted", on_disk_hash: "submitted-hash" };
    invoke.mockResolvedValue(snapshot);
    expect(await doc.docCreate("note.md", "submitted")).toBe(snapshot);
    expect(invoke.mock.calls).toEqual([["doc_create", { origin: { kind: "user" }, path: "note.md", content: "submitted" }]]);
  });
  it("surfaces actionable backend string errors without fallback writes or reads", async () => {
    invoke.mockRejectedValue("Destination already exists; reload from disk");
    const error = await doc.docCreate("note.md", "local").catch((reason: unknown) => reason);
    expect(error).toBe("Destination already exists; reload from disk");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("doc_create", { origin: { kind: "user" }, path: "note.md", content: "local" });
  });
});
