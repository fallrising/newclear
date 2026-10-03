import { fireEvent, screen, waitFor } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { server } from "@cms/mocks/node";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute } from "../test-utils";

function open(newEntry = false) {
  setUser("seed-operator-album");
  const entry = db.workEntries.find((item) => item.slug === "private-studio")!;
  entry.payload = { title: "Studio", count: 4, enabled: true, status: "draft", media: "existing-id" };
  server.use(http.get("*/api/v1/content-types/album", () => HttpResponse.json({
    key: "album", displayName: "Album", pluralDisplayName: "Albums", titleField: "title", slugPolicy: "optional",
    fields: [
      { key: "title", type: "string", required: false, enumValues: [] },
      { key: "count", type: "int", required: false, enumValues: [] },
      { key: "enabled", type: "boolean", required: false, enumValues: [] },
      { key: "status", type: "enum", required: false, enumValues: ["draft", "ready"] },
      { key: "media", type: "media-ref", required: false, enumValues: [] },
    ],
  })));
  const requests = recordRequests();
  renderRoute(`/entries/album/${newEntry ? "new" : entry.id}`);
  return { requests, entry };
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
}

describe("P0 typed entry editing", () => {
  it("sends explicit null when existing fields are cleared", async () => {
    const { requests } = open();
    fireEvent.change(await screen.findByLabelText("title (string)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("count (int)"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "enabled (boolean)" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "status (enum)" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("media (media-ref)"), { target: { value: "" } });
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toMatchObject({ payload: { title: null, count: null, enabled: null, status: null, media: null } });
  });

  it("offers boolean and enum choices and sends false and an integer", async () => {
    const { requests } = open();
    const enabled = await screen.findByRole("combobox", { name: "enabled (boolean)" });
    fireEvent.change(enabled, { target: { value: "false" } });
    fireEvent.change(screen.getByRole("combobox", { name: "status (enum)" }), { target: { value: "ready" } });
    fireEvent.change(screen.getByLabelText("count (int)"), { target: { value: "12" } });
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toMatchObject({ payload: { enabled: false, status: "ready", count: 12 } });
  });

  it.each(["1.5", "NaN", "Infinity", "12oops", "9007199254740993"])("rejects invalid integer %s while retaining draft", async (raw) => {
    const { requests } = open();
    fireEvent.change(await screen.findByLabelText("count (int)"), { target: { value: raw } });
    await submit();
    expect(await screen.findByText(/請輸入有限整數/)).toBeInTheDocument();
    expect(screen.getByLabelText("count (int)")).toHaveValue(raw);
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("omits unset new fields", async () => {
    const { requests } = open(true);
    await screen.findByLabelText("title (string)");
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/entries"))).toBe(true));
    expect(requests.find((r) => r.method === "POST" && r.path.endsWith("/entries"))!.body).toMatchObject({ payload: {} });
  });

  it("requires saving local changes before lifecycle actions", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("title (string)"), { target: { value: "Unsaved title" } });
    for (const label of ["發布", "下架", "封存"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(screen.getByText(/請先儲存變更/)).toBeInTheDocument();
    await submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "發布" })).toBeEnabled());
  });

  it("resyncs returned content after a lifecycle action before saving again", async () => {
    const { entry, requests } = open();
    await screen.findByLabelText("title (string)");
    entry.payload = { ...entry.payload, title: "Another writer's title", count: 29 };
    entry.slug = "another-writer";
    entry.version += 1;
    fireEvent.click(screen.getByRole("button", { name: "發布" }));
    await screen.findByTestId("editor-notice");
    expect(screen.getByLabelText("title (string)")).toHaveValue("Another writer's title");
    expect(screen.getByLabelText("count (int)")).toHaveValue("29");
    expect(screen.getByLabelText("slug")).toHaveValue("another-writer");
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存草稿" })).toBeEnabled());
    await submit();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toMatchObject({ slug: "another-writer", payload: { title: "Another writer's title", count: 29 } });
  });

  it("retains success feedback and uses the saved version for a second save", async () => {
    const { requests, entry } = open();
    const version = entry.version;
    fireEvent.change(await screen.findByLabelText("title (string)"), { target: { value: "Saved title" } });
    await submit();
    expect(await screen.findByTestId("editor-notice")).toHaveTextContent("已儲存工作副本");
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存草稿" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("title (string)"), { target: { value: "Second title" } });
    await submit();
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
    expect(requests.filter((r) => r.method === "PATCH")[1].body).toMatchObject({ version: version + 1, payload: { title: "Second title" } });
  });

  it("explains a conflict and preserves every local draft field", async () => {
    open();
    setScenario("conflict");
    fireEvent.change(await screen.findByLabelText("title (string)"), { target: { value: "Local draft" } });
    fireEvent.change(screen.getByLabelText("count (int)"), { target: { value: "19" } });
    await submit();
    expect(await screen.findByText(/重新載入/)).toBeInTheDocument();
    expect(screen.getByLabelText("title (string)")).toHaveValue("Local draft");
    expect(screen.getByLabelText("count (int)")).toHaveValue("19");
  });

  it.each(["save", "publish", "upload"])("prevents overlapping writes during %s", async (action) => {
    const { requests } = open();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const method = action === "save" ? http.patch : http.post;
    const path = action === "save" ? "*/api/v1/entries/:id" : action === "publish" ? "*/api/v1/entries/:id/publish" : "*/api/v1/media";
    server.use(method(path, async () => { await blocked; return HttpResponse.json({}); }));
    await screen.findByLabelText("title (string)");
    if (action === "save") await submit();
    else if (action === "publish") fireEvent.click(screen.getByRole("button", { name: "發布" }));
    else fireEvent.change(screen.getByLabelText("media file"), { target: { files: [new File(["image"], "image.png", { type: "image/png" })] } });
    try {
      await waitFor(() => expect(requests.some((r) => r.method !== "GET")).toBe(true));
      for (const label of ["儲存草稿", "發布", "下架", "封存"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
      expect(screen.getByLabelText("media file")).toBeDisabled();
      fireEvent.submit(screen.getByRole("button", { name: "儲存草稿" }).closest("form")!);
      fireEvent.click(screen.getByRole("button", { name: "發布" }));
      expect(requests.filter((r) => r.method !== "GET")).toHaveLength(1);
    } finally { release(); }
  });
});
