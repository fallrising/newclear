import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { server } from "@cms/mocks/node";
import { keys, type WorkContentType } from "@cms/api";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute } from "../test-utils";

function open(newEntry = false) {
  setUser("seed-operator-album");
  const entry = db.workEntries.find((item) => item.slug === "private-studio")!;
  entry.payload = { title: "Studio", count: 4, enabled: true, status: "draft", media: "20000000-0000-4000-8000-000000000001" };
  const prototype = db.adminTypes.find((type) => type.key === "album")!.fields[0];
  const fields = [
    { key: "title", label: "標題", type: "string" }, { key: "count", label: "數量", type: "int" },
    { key: "enabled", label: "啟用", type: "boolean" }, { key: "status", label: "狀態選項", type: "enum", enumValues: ["draft", "ready"], enumLabels: { draft: "草稿", ready: "就緒" } },
    { key: "media", label: "圖片", type: "media-ref", group: "media" },
  ].map((field, order) => ({ ...prototype, required: false, enumValues: [], enumLabels: {}, group: "main", ...field, order }));
  const schema = { key: "album", displayName: "Album", pluralDisplayName: "Albums", titleField: "title", slugPolicy: "optional", singleton: false, sortField: null, visibilityField: null, ownerField: null, previewable: true, fields } as WorkContentType;
  server.use(http.get("*/api/v1/content-types/album", () => HttpResponse.json(schema)));
  const requests = recordRequests();
  const rendered = renderRoute(`/entries/album/${newEntry ? "new" : entry.id}`);
  return { requests, entry, ...rendered };
}
const writes = (requests: ReturnType<typeof recordRequests>) => requests.filter((r) => r.method !== "GET" && !r.path.endsWith("/csrf"));
async function submit() { fireEvent.click(screen.getByTestId("save-bar-save")); }

describe("P0 typed entry editing migrated to W1", () => {
  it("sends explicit null for cleared editable fields and preserves readonly media", async () => {
    const { requests, entry } = open();
    const media = entry.payload.media;
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/^數量/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "清除啟用" }));
    fireEvent.click(within(screen.getByTestId("field-status-radio")).getByRole("radio", { name: "未設定" }));
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toMatchObject({ payload: { title: null, count: null, enabled: null, status: null } });
    expect((requests.find((r) => r.method === "PATCH")!.body as { payload: object }).payload).not.toHaveProperty("media");
    expect(entry.payload.media).toBe(media);
  });
  it("offers boolean and enum choices and sends false and an integer", async () => {
    const { requests } = open();
    fireEvent.click(await screen.findByRole("switch", { name: /^啟用/ }));
    fireEvent.click(within(screen.getByTestId("field-status-radio")).getByRole("radio", { name: "就緒" }));
    fireEvent.change(screen.getByLabelText(/^數量/), { target: { value: "12" } });
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toMatchObject({ payload: { enabled: false, status: "ready", count: 12 } });
  });
  it.each(["1.5", "NaN", "Infinity", "12oops", "9007199254740993"])("rejects invalid integer %s while retaining draft", async (raw) => {
    const { requests } = open();
    fireEvent.change(await screen.findByLabelText(/^數量/), { target: { value: raw } });
    await submit();
    expect(await screen.findByTestId("field-count-error")).toHaveTextContent("格式不正確");
    expect(screen.getByLabelText(/^數量/)).toHaveValue(raw);
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });
  it("omits unset readonly fields on new entries", async () => {
    const { requests } = open(true);
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "New draft" } });
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/entries"))).toBe(true));
    const payload = (requests.find((r) => r.method === "POST" && r.path.endsWith("/entries"))!.body as { payload: object }).payload;
    expect(payload).not.toHaveProperty("media");
    expect(payload).toMatchObject({ title: "New draft", count: null, status: null });
  });
  it("requires saving local changes before lifecycle actions", async () => {
    open();
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Unsaved title" } });
    expect(screen.queryByTestId("details-publish")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("page-more-actions"), { key: "Enter" });
    expect(screen.getByTestId("details-archive")).toHaveAttribute("data-disabled");
    await submit();
    await waitFor(() => expect(screen.getByTestId("details-publish")).toBeEnabled());
  });
  it("resyncs returned content and baseline after lifecycle before saving again", async () => {
    const { entry, requests } = open();
    await screen.findByLabelText(/^標題/);
    entry.payload = { ...entry.payload, title: "Another writer's title", count: 29 };
    entry.title = "Another writer's title"; entry.slug = "another-writer"; entry.version += 1;
    fireEvent.click(screen.getByTestId("details-publish"));
    await screen.findByText("已發布", { selector: "[data-title]" });
    expect(screen.getByLabelText(/^標題/)).toHaveValue("Another writer's title");
    expect(screen.getByLabelText(/^數量/)).toHaveValue("29");
    expect(screen.getByLabelText(/^網址代稱/)).toHaveValue("another-writer");
    fireEvent.change(screen.getByLabelText(/^標題/), { target: { value: "Next edit" } });
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({ version: entry.version - 1, payload: { title: "Next edit" } });
  });
  it("retains feedback and uses the saved version for a second save", async () => {
    const { requests, entry } = open(); const version = entry.version;
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Saved title" } });
    await submit();
    expect((await screen.findAllByText("已儲存")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^標題/), { target: { value: "Second title" } });
    await submit();
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
    expect(requests.filter((r) => r.method === "PATCH")[1].body).toMatchObject({ version: version + 1, payload: { title: "Second title" } });
  });
  it("explains a conflict and preserves every local draft field", async () => {
    open(); setScenario("conflict");
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Local draft" } });
    fireEvent.change(screen.getByLabelText(/^數量/), { target: { value: "19" } });
    await submit();
    expect(await screen.findByTestId("conflict-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("conflict-keep"));
    expect(screen.getByLabelText(/^標題/)).toHaveValue("Local draft");
    expect(screen.getByLabelText(/^數量/)).toHaveValue("19");
  });
  it.each(["save", "publish"])("prevents overlapping writes during %s", async (action) => {
    const { requests, entry } = open();
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
    const method = action === "save" ? http.patch : http.post;
    const path = action === "save" ? "*/api/v1/entries/:id" : "*/api/v1/entries/:id/publish";
    server.use(method(path, async () => { await blocked; return HttpResponse.json({ ...entry, version: entry.version + 1 }); }));
    await screen.findByLabelText(/^標題/);
    if (action === "save") { fireEvent.change(screen.getByLabelText(/^標題/), { target: { value: "Pending" } }); await submit(); }
    else fireEvent.click(screen.getByTestId("details-publish"));
    try {
      await waitFor(() => expect(writes(requests)).toHaveLength(1));
      expect(screen.getByLabelText(/^標題/)).toBeDisabled();
      expect(screen.getByLabelText(/^數量/)).toBeDisabled();
      fireEvent.submit(screen.getByLabelText(/^標題/).closest("form")!);
      if (screen.queryByTestId("details-publish")) fireEvent.click(screen.getByTestId("details-publish"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(writes(requests)).toHaveLength(1);
    } finally { release(); }
  });
  it("background refetch preserves dirty values and their original expected version", async () => {
    const { requests, entry, queryClient } = open(); const version = entry.version;
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Local input" } });
    entry.version += 1; entry.payload.title = "Remote input";
    await queryClient.invalidateQueries({ queryKey: keys.entries.detail(entry.id) });
    expect(screen.getByLabelText(/^標題/)).toHaveValue("Local input");
    await submit();
    expect(await screen.findByTestId("conflict-dialog")).toBeInTheDocument();
    expect(requests.find((request) => request.method === "PATCH")!.body).toMatchObject({ version, payload: { title: "Local input" } });
  });
});

describe("P0 cached editor protection", () => {
  it.each(["entry", "schema"])("a failed background %s read preserves dirty input and save baseline", async (read) => {
    const { entry, queryClient } = open();
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Keep my draft" } });
    server.use(http.get(read === "entry" ? "*/api/v1/entries/:id" : "*/api/v1/content-types/album", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "unavailable" } }, { status: 500 })));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: read === "entry" ? keys.entries.detail(entry.id) : keys.types.detail("album") });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByLabelText(/^標題/)).toHaveValue("Keep my draft");
    expect(screen.getByTestId("save-bar")).toBeInTheDocument();
  });
});


describe("P0 reload protection", () => {
  it("prevents overlapping reload and save while preserving draft until latest content arrives", async () => {
    const { entry, requests } = open();
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Local draft" } });
    setScenario("conflict");
    await submit(); await screen.findByTestId("conflict-dialog");
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.get("*/api/v1/entries/:id", async () => { await pending; return HttpResponse.json({ ...entry, version: entry.version + 1, payload: { ...entry.payload, title: "Latest title" } }); }));
    const readsBefore = requests.filter((request) => request.method === "GET" && request.path.endsWith(entry.id)).length;
    fireEvent.click(screen.getByTestId("conflict-reload"));
    fireEvent.click(screen.getByTestId("conflict-reload"));
    try {
      await waitFor(() => expect(screen.getByTestId("conflict-reload")).toBeDisabled());
      expect(screen.getByTestId("conflict-keep")).toBeDisabled();
      expect(screen.getByLabelText(/^標題/)).toHaveValue("Local draft");
      fireEvent.submit(screen.getByLabelText(/^標題/).closest("form")!);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(requests.filter((request) => request.method === "GET" && request.path.endsWith(entry.id))).toHaveLength(readsBefore + 1);
      expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    } finally { release(); }
    await waitFor(() => expect(screen.getByLabelText(/^標題/)).toHaveValue("Latest title"));
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
  });
});
