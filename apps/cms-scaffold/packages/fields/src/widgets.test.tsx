import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { createCmsClient } from "@cms/api";
import { db, fixtures, setUser } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
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
const api = createCmsClient({ baseUrl: "http://localhost:8080" });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function Form({ values }: { values: FormValues }) {
  const form = useForm<FormValues>({ defaultValues: values });
  return (
    <form>
      {note.fields.map((field) => (
        <FieldWidget key={field.key} field={field} control={form.control} />
      ))}
    </form>
  );
}

function renderNote(slug: string) {
  const entry = db.workEntries.find((e) => e.slug === slug)!;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FieldsProvider value={{ work: api.work, url: api.url }}>
        <Form values={toFormValues(note, entry.payload)} />
      </FieldsProvider>
    </QueryClientProvider>,
  );
}

describe("FieldWidget", () => {
  it("V2-AC-05 renders the 01 §6.4 control for every field type and shows no raw UUID", async () => {
    renderNote("lens-notes");
    expect(screen.getByLabelText(/標題/)).toHaveValue("Lens notes");
    expect(screen.getByLabelText(/內文/).tagName).toBe("TEXTAREA");
    expect(within(screen.getByTestId("field-category-radio")).getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByTestId("field-color-select")).toHaveAttribute("role", "combobox");
    expect(screen.getByLabelText(/優先順序/)).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("field-dueAt-date")).toHaveTextContent("選擇日期");
    expect(await screen.findByText("Buy film")).toBeInTheDocument();
    const image = await screen.findByRole("img", { name: "Late sun" });
    expect(image).toHaveAttribute("width", "64");
    expect(image).toHaveAttribute("height", "64");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("src", "http://localhost:8080/api/v1/media/20000000-0000-4000-8000-000000000002/file/thumbnail");
    expect(screen.getByTestId("field-location-row")).toHaveAttribute("data-field-type", "unknown");
    expect(document.body.textContent).not.toMatch(UUID);
  });

  it("V2-AC-05 marks required fields and shows enum labels", () => {
    renderNote("buy-film");
    expect(screen.getByText("標題").parentElement).toHaveTextContent("標題*");
    expect(screen.getByLabelText("待辦")).toBeChecked();
    expect(screen.getByTestId("field-color-select")).toHaveTextContent("黃");
  });

  it("C-09 datetime shows the local date and time of the stored UTC instant", () => {
    renderNote("buy-film");
    // 2026-10-01T09:30:00Z is 17:30 in Asia/Taipei (vitest.config.ts sets TZ)
    expect(screen.getByTestId("field-dueAt-time")).toHaveValue("17:30");
    expect(screen.getByTestId("field-dueAt-date")).toHaveTextContent("2026年10月1日");
  });

  it("S-04 D-08 the markdown preview renders Markdown and never raw HTML", () => {
    renderNote("buy-film");
    fireEvent.change(screen.getByLabelText(/內文/), { target: { value: "**bold** <script>alert(1)</script>" } });
    fireEvent.mouseDown(screen.getByTestId("field-body-preview-tab"));
    const preview = screen.getByTestId("field-body-preview");
    expect(within(preview).getByText("bold").tagName).toBe("STRONG");
    expect(preview.querySelector("script")).toBeNull();
  });
});
