import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCmsClient } from "@cms/api";
import { fixtures, setUser } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldsProvider } from "./context";
import { displayable, FieldDisplay } from "./display";
import { RefValue } from "./values";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => { resetMocks(); setUser("mock-operator-notes"); });
const note = fixtures.workContentTypes.items.find((t) => t.key === "note")!;
const field = (key: string) => note.fields.find((f) => f.key === key)!;
const api = createCmsClient({ baseUrl: "http://localhost:8080" });

function show(children: React.ReactNode, work = api.work) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FieldsProvider value={{ work, url: api.url }}>{children}</FieldsProvider></QueryClientProvider>);
}

describe("W2 saved preview and summaries", () => {
  it("shows a BW1c media projection as an image with its real web dimensions", async () => {
    const value = { mediaId: fixtures.mediaAssets.items[0].id, variants: {} };
    expect(displayable(field("attachment"), value)).toBe(true);
    show(<FieldDisplay field={field("attachment")} value={value} />);
    const image = await screen.findByTestId("preview-image");
    expect(image).toHaveAttribute("src", expect.stringContaining("/file/web"));
    expect(image).toHaveAttribute("width", "64");
    expect(image).toHaveAttribute("height", "64");
  });
  it("renders markdown safely, false distinctly, and omits unknown field values", () => {
    show(<><FieldDisplay field={field("body")} value={'**Readable**<script>alert("unsafe")</script>'} /><FieldDisplay field={field("pinned")} value={false} /><FieldDisplay field={field("location")} value={{ lat: 23 }} /></>);
    expect(screen.getByText("Readable").tagName).toBe("STRONG");
    expect(screen.getByText("否")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(displayable(field("location"), { lat: 23 })).toBe(false);
  });
  it("renders authorized/restricted/missing summaries without fetching any target entry", async () => {
    const entry = vi.fn(api.work.entry);
    show(<><RefValue id="readable" summary={{ id: "readable", title: "Visible title", contentType: "note", publicationState: "draft" }} plain /><RefValue id="restricted" summary={{ id: "restricted", restricted: true }} /><RefValue id="missing" summary={{ id: "missing", missing: true }} /></>, { ...api.work, entry });
    expect(screen.getByText("Visible title")).toBeInTheDocument();
    expect(screen.getByText("你無法檢視這個項目")).toBeInTheDocument();
    expect(screen.getByText("連結的項目已不存在")).toBeInTheDocument();
    expect(screen.queryByTestId("status-badge")).not.toBeInTheDocument();
    await waitFor(() => expect(entry).not.toHaveBeenCalled());
  });
});
