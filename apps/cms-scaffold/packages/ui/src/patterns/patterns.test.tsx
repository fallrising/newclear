import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppFrame } from "./app-frame";
import { TitleSuffixContext } from "./document-title";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { QueryBoundary, type QueryLike } from "./query-boundary";

function query<T>(partial: Partial<QueryLike<T>>): QueryLike<T> {
  return { isPending: false, isError: false, error: null, data: undefined, refetch: vi.fn(), ...partial };
}

const renderList = (q: QueryLike<string[]>) =>
  render(
    <QueryBoundary
      query={q}
      isEmpty={(items) => items.length === 0}
      empty={<EmptyState title="空的" />}
      notFound={<p>找不到</p>}
    >
      {(items) => <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </QueryBoundary>,
  );

describe("QueryBoundary", () => {
  it("C-02 shows a skeleton while pending and never the empty state", () => {
    renderList(query({ isPending: true }));
    expect(screen.getByTestId("query-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("C-02 shows the empty state only after data arrives empty", () => {
    renderList(query({ data: [] }));
    expect(screen.getByTestId("empty-state")).toHaveTextContent("空的");
  });

  it("C-02 renders children once data arrives", () => {
    renderList(query({ data: ["a", "b"] }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("C-03 W0-FM08 W0-FM09 a 404 renders notFound; a 500 renders the error with a working retry", () => {
    renderList(query({ isError: true, error: { status: 404 } }));
    expect(screen.getByText("找不到")).toBeInTheDocument();
    const refetch = vi.fn();
    renderList(query({ isError: true, error: { status: 500 }, refetch }));
    fireEvent.click(screen.getByTestId("query-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("query-error")).toHaveTextContent("無法載入");
  });
});

describe("PageHeader", () => {
  it("F-05 writes '<title> · <suffix>' to document.title", () => {
    render(
      <MemoryRouter>
        <TitleSuffixContext.Provider value="CMS 作業台">
          <PageHeader title="相簿" />
        </TitleSuffixContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "相簿" })).toBeInTheDocument();
    expect(document.title).toBe("相簿 · CMS 作業台");
  });

  it("E-01 PageHeader shows up to two secondary actions as buttons and collapses three or more into a menu", () => {
    const one = { label: "一" };
    const two = { label: "二" };
    const { unmount } = render(
      <MemoryRouter>
        <PageHeader title="t" secondaryActions={[one, two]} primaryAction={{ label: "主要", to: "/x" }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "一" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "主要" })).toHaveAttribute("href", "/x");
    unmount();
    render(
      <MemoryRouter>
        <PageHeader title="t" secondaryActions={[one, two, { label: "三" }]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "一" })).not.toBeInTheDocument();
    expect(screen.getByTestId("page-more-actions")).toHaveTextContent("更多動作");
  });
});

describe("AppFrame", () => {
  const nav = [{ items: [{ label: "首頁", to: "/", end: true }] }, { label: "內容", items: [{ label: "album", to: "/entries/album" }] }];

  it("E-01 F-05 AppFrame marks the current route and sets the title suffix", () => {
    render(
      <MemoryRouter initialEntries={["/entries/album"]}>
        <AppFrame product="back" productName="CMS 作業台" nav={nav} account={{ displayName: "A", detail: "operator" }} onSignOut={vi.fn()}>
          <PageHeader title="相簿" />
        </AppFrame>
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link", { name: "album" });
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe("相簿 · CMS 作業台");
    expect(screen.queryByTestId("admin-accent")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("E-01 AppFrame shows the admin accent bar only on the admin product", () => {
    render(
      <MemoryRouter>
        <AppFrame product="admin" productName="Admin center" nav={nav} account={{ displayName: "A", detail: "admin" }} onSignOut={vi.fn()}>
          x
        </AppFrame>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("admin-accent")).toBeInTheDocument();
  });
});
