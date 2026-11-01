import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm, useWatch, type Control } from "react-hook-form";
import { ApiError, createCmsClient, type MediaAsset, type WorkApi } from "@cms/api";
import { db, fixtures, setUser } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { Toaster } from "@cms/ui";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FieldsProvider } from "./context";
import { toFormValues, type FormValues } from "./form";
import { FieldWidget } from "./widgets";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  resetMocks();
  setUser("mock-operator-notes");
});

const note = fixtures.workContentTypes.items.find((t) => t.key === "note")!;
const field = (key: string) => note.fields.find((f) => f.key === key)!;
const api = createCmsClient({ baseUrl: "http://localhost:8080" });
const entry = (slug: string) => db.workEntries.find((e) => e.slug === slug)!;

function Value({ control, name }: { control: Control<FormValues>; name: string }) {
  return <output data-testid={`value-${name}`}>{String(useWatch({ control, name }) ?? "")}</output>;
}

function Form({ values, keys, disabled }: { values: FormValues; keys: string[]; disabled?: boolean }) {
  const form = useForm<FormValues>({ defaultValues: values });
  return (
    <form>
      {keys.map((key) => (
        <div key={key}>
          <FieldWidget field={field(key)} control={form.control} disabled={disabled} />
          <Value control={form.control} name={key} />
        </div>
      ))}
    </form>
  );
}

function recordGets(): string[] {
  const paths: string[] = [];
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    if (request.method === "GET") paths.push(`${url.pathname}${url.search}`);
  });
  return paths;
}

function renderNote(slug: string, keys: string[], disabled = false, work: WorkApi = api.work) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FieldsProvider value={{ work, url: api.url }}>
        <Form values={toFormValues(note, entry(slug).payload)} keys={keys} disabled={disabled} />
        <Toaster />
      </FieldsProvider>
    </QueryClientProvider>,
  );
}

describe("RelationPicker (ref)", () => {
  it("V2-AC-05 searches the target type by title (drafts included) and shows the chosen entry at once", async () => {
    const gets = recordGets();
    renderNote("lens-notes", ["related"]);
    expect(await screen.findByText("Buy film")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更換相關筆記" }));
    const dialog = await screen.findByTestId("relation-picker");
    expect(within(dialog).getByRole("heading", { name: "選擇相關筆記" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByTestId("picker-option").map((o) => o.textContent)).toEqual(["Buy film草稿", "Ideas for spring已發布有未發布的變更", "Lens notes已發布"]));
    expect(within(dialog).getByRole("radio", { name: /Buy film/ })).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText("搜尋標題"), { target: { value: "spring" } });
    await waitFor(() => expect(within(dialog).getAllByTestId("picker-option")).toHaveLength(1));
    expect(gets).toContain("/api/v1/content-types/note/entries?q=spring&size=20&sort=title");
    expect(within(dialog).getByTestId("picker-confirm")).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Ideas for spring/ }));
    fireEvent.click(within(dialog).getByTestId("picker-confirm"));
    // The chosen entry is already in the cache: its title shows in the same render, with no loading skeleton.
    expect(within(screen.getByTestId("field-related-picker")).getByText("Ideas for spring")).toBeInTheDocument();
    expect(screen.getByTestId("value-related")).toHaveTextContent(entry("spring-ideas").id);
    await waitFor(() => expect(screen.queryByTestId("relation-picker")).not.toBeInTheDocument());
  });

  it("C-05 移除 clears the value; the search shows a note when nothing matches", async () => {
    renderNote("lens-notes", ["related"]);
    fireEvent.click(await screen.findByRole("button", { name: "移除相關筆記" }));
    expect(screen.getByTestId("value-related")).toHaveTextContent("");
    expect(within(screen.getByTestId("field-related-picker")).getByText("未設定")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "選擇相關筆記" }));
    fireEvent.change(await screen.findByLabelText("搜尋標題"), { target: { value: "zzz" } });
    expect(await screen.findByText("找不到符合的項目。")).toBeInTheDocument();
  });

  it("01 §8 a target type the user cannot read shows a note instead of a list", async () => {
    setUser("seed-operator-album");
    renderNote("buy-film", ["related"]);
    fireEvent.click(await screen.findByRole("button", { name: "選擇相關筆記" }));
    expect(await screen.findByText("你沒有檢視這類項目的權限。")).toBeInTheDocument();
  });

  it("disabled pickers show the value without buttons", async () => {
    renderNote("buy-film", ["attachment"], true);
    expect(await screen.findByRole("img", { name: "Harbour wall" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("MediaPicker (media-ref)", () => {
  it("V2-AC-05 B-S4 the library tab filters by name and uses the chosen file", async () => {
    renderNote("buy-film", ["attachment"]);
    expect(await screen.findByRole("img", { name: "Harbour wall" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更換附件" }));
    const dialog = await screen.findByTestId("media-picker");
    await waitFor(() => expect(within(dialog).getAllByTestId("picker-option")).toHaveLength(8));
    fireEvent.change(within(dialog).getByLabelText("搜尋名稱"), { target: { value: "soft" } });
    expect(within(dialog).getAllByTestId("picker-option")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Softbox/ }));
    fireEvent.click(within(dialog).getByTestId("picker-confirm"));
    await waitFor(() => expect(screen.queryByTestId("media-picker")).not.toBeInTheDocument());
    expect(screen.getByTestId("value-attachment")).toHaveTextContent("20000000-0000-4000-8000-000000000008");
    expect(within(screen.getByTestId("field-attachment-picker")).getByText("Softbox")).toBeInTheDocument();
  });

  // jsdom's FormData cannot travel through Node's fetch, so the upload call is replaced here; the real multipart
  // upload runs in the browser (e2e-mock/back-w2.spec.ts).
  it("B-S4 upload: the size limit comes from the quota; a bigger file is refused before sending; errors have words; an upload is chosen at once", async () => {
    const sent: string[] = [];
    const uploaded: MediaAsset = { ...db.media[0], id: "20000000-0000-4000-8000-0000000000aa", mediaId: "20000000-0000-4000-8000-0000000000aa", title: "dock.png", altText: "dock.png" };
    const work: WorkApi = {
      ...api.work,
      upload: async (file: File) => {
        sent.push(file.name);
        if (file.name === "notes.txt") throw new ApiError(415, "MEDIA_UNSUPPORTED_TYPE", "Unsupported media type");
        if (file.name === "server-large.png") throw new ApiError(413, "MEDIA_FILE_TOO_LARGE", "File too large");
        if (file.name === "full.png") throw new ApiError(409, "MEDIA_QUOTA_EXCEEDED", "Quota exceeded");
        db.media.unshift(uploaded);
        return uploaded;
      },
    };
    renderNote("lens-notes", ["attachment"], false, work);
    fireEvent.click(await screen.findByRole("button", { name: "更換附件" }));
    fireEvent.mouseDown(await screen.findByTestId("media-tab-upload"));
    expect(await screen.findByText("JPEG、PNG、GIF 或 PDF，每個檔案最大 15 MB。")).toBeInTheDocument();
    const input = screen.getByTestId("media-upload-input");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(15 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" })] } });
    expect(await screen.findByTestId("media-upload-error")).toHaveTextContent("檔案太大，上限是 15 MB。");
    expect(sent).toEqual([]);
    fireEvent.change(input, { target: { files: [new File(["txt"], "notes.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(screen.getByTestId("media-upload-error")).toHaveTextContent("只接受 JPEG、PNG、GIF 或 PDF。"));
    fireEvent.change(input, { target: { files: [new File(["png"], "server-large.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByTestId("media-upload-error")).toHaveTextContent("檔案太大，上限是 15 MB。"));
    fireEvent.change(input, { target: { files: [new File(["png"], "full.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByTestId("media-upload-error")).toHaveTextContent("媒體庫的空間已滿，請先移除不用的檔案。"));
    fireEvent.change(input, { target: { files: [new File(["png"], "dock.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.queryByTestId("media-picker")).not.toBeInTheDocument());
    expect(sent).toEqual(["notes.txt", "server-large.png", "full.png", "dock.png"]);
    expect(await screen.findByText("已上傳「dock.png」")).toBeInTheDocument();
    expect(screen.getByTestId("value-attachment")).toHaveTextContent(uploaded.id);
    expect(within(screen.getByTestId("field-attachment-picker")).getByText("dock.png")).toBeInTheDocument();
  });

  it("W2-FM11 without manage_media the library tab says so instead of listing files", async () => {
    const global = fixtures.capabilities["mock-operator-notes"].back.global;
    global.splice(0, global.length);
    try {
      renderNote("buy-film", ["attachment"]);
      fireEvent.click(await screen.findByRole("button", { name: "更換附件" }));
      expect(await screen.findByText("你沒有使用媒體庫的權限。")).toBeInTheDocument();
    } finally {
      global.push("manage_media");
    }
  });
});
