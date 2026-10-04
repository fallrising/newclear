import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { hydrate, materializeEdge, readCanvasSidecar, serializeNodes, serializeEdges } from "./persistence";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const sidecar = () => ({ version: 1, nodes: [
  { id: "d", kind: { type: "document", path: "notes.md" }, x: 1, y: 2, w: 800, h: 500, group: "work" },
  { id: "t", kind: { type: "tombstone", reason: "exited", was: { type: "terminal", cwd: "/tmp", cmd: null, shell: "sh" } }, x: 3, y: 4, w: 300, h: 150, group: null },
], edges: [{ id: "e", from: "t", to: "d", kind: "context_for" }] });

describe("authoritative sidecar", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  it("initializes only a missing sidecar", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await readCanvasSidecar()).toBeNull();
  });
  it.each(["{", JSON.stringify({ version: 2, nodes: [], edges: [] }),
    JSON.stringify({ version: 1, nodes: {}, edges: [] }),
    JSON.stringify({ ...sidecar(), nodes: [{ ...sidecar().nodes[0], w: -1 }] }),
    JSON.stringify({ ...sidecar(), edges: [{ id: "e", from: "missing", to: "d", kind: "context_for" }] }),
    JSON.stringify({ ...sidecar(), edges: [{ id: "e", from: "t", to: "d", kind: ["context_for"] }] }),
  ])("rejects invalid data instead of returning an empty canvas: %s", async (raw) => {
    vi.mocked(invoke).mockResolvedValue(raw);
    await expect(readCanvasSidecar()).rejects.toThrow();
    expect(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)).toEqual(["canvas_read"]);
  });
  it.each([
    { ...sidecar(), future: true },
    { ...sidecar(), nodes: [{ ...sidecar().nodes[0], extra: "preserve me" }] },
    { ...sidecar(), nodes: [{ ...sidecar().nodes[0], kind: { type: "terminal", session_id: "live" } }] },
    { ...sidecar(), nodes: [{ ...sidecar().nodes[0], kind: { type: "tombstone", reason: "missing", was: { type: "document", path: "x.md" } } }] },
  ])("preserves unsupported valid v1 content by blocking overwrite", async (value) => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify(value));
    await expect(readCanvasSidecar()).rejects.toThrow(/read.only|unsupported|preserv/i);
  });
  it("retains dimensions, grouping and reconstructs handles without schema extensions", async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify(sidecar()));
    const loaded = (await readCanvasSidecar())!;
    const restored = hydrate(loaded);
    expect(restored.nodes[0]).toMatchObject({ width: 800, height: 500, group: "work" });
    const edge = materializeEdge(restored.edges[0]!);
    expect(edge).toMatchObject({ sourceHandle: "context-out", targetHandle: "in" });
    const nodes = restored.nodes.map((n) => ({ id: n.id, type: n.kind, position: n.position,
      style: { width: n.width, height: n.height }, data: n.kind === "document" ? { path: n.path, sidecarGroup: n.group } : { reason: n.reason, was: n.was, sidecarGroup: n.group } }));
    expect(serializeNodes(nodes)).toEqual(loaded.nodes);
    expect(serializeEdges([edge])).toEqual(loaded.edges);
  });
  it("persists a freshly exited runtime terminal as a valid v1 tombstone", async () => {
    const nodes = serializeNodes([{ id: "ended", type: "tombstone", position: { x: 1, y: 2 }, data: { reason: "exited", was: { cwd: "/tmp", shell: "sh", cmd: null } } }]);
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({ version: 1, nodes, edges: [] }));
    expect(await readCanvasSidecar()).toMatchObject({ nodes: [{ kind: { was: { type: "terminal" } } }] });
  });
});
