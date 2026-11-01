import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ContextualSaveBar } from "./contextual-save-bar";
import { IndexFilters } from "./index-filters";
import { IndexPagination } from "./index-pagination";
import { IndexTable } from "./index-table";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";

type Row = { id: string; title: string };
const columns = [
  { key: "title", header: "標題", cell: (r: Row) => r.title },
  { key: "id", header: "代號", cell: (r: Row) => r.id },
];

function table(rows: Row[] | undefined, loading: boolean) {
  return (
    <MemoryRouter>
      <IndexTable columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/x/${r.id}`} rowLabel={(r) => r.title} loading={loading} empty={<p>空</p>} />
    </MemoryRouter>
  );
}

describe("W1 patterns", () => {
  it("C-06 StatusBadge shows the state and, for a dirty published entry, the change badge", () => {
    const { rerender } = render(<StatusBadge state="draft" dirty />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("草稿");
    expect(screen.queryByText("有未發布的變更")).not.toBeInTheDocument();
    rerender(<StatusBadge state="published" dirty />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("已發布有未發布的變更");
  });

  it("C-02 IndexTable shows skeleton rows while loading and the empty slot only when loaded empty", () => {
    const { rerender } = render(table(undefined, true));
    expect(screen.getAllByTestId("index-row-loading")).toHaveLength(5);
    expect(screen.queryByText("空")).not.toBeInTheDocument();
    rerender(table([], false));
    expect(screen.getByText("空")).toBeInTheDocument();
    rerender(table([{ id: "a", title: "甲" }], false));
    expect(screen.getByRole("link", { name: "甲" })).toHaveAttribute("href", "/x/a");
  });

  it("U-04 IndexFilters calls onQueryChange 300ms after typing stops", () => {
    vi.useFakeTimers();
    const onQueryChange = vi.fn();
    render(
      <IndexFilters
        tabs={[{ value: "all", label: "全部" }]}
        tab="all"
        onTabChange={vi.fn()}
        query=""
        onQueryChange={onQueryChange}
        filters={[]}
        onFilterChange={vi.fn()}
        sortOptions={[{ value: "-updatedAt", label: "最近更新" }]}
        sort="-updatedAt"
        onSortChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("index-search"), { target: { value: "co" } });
    act(() => vi.advanceTimersByTime(299));
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onQueryChange).toHaveBeenCalledWith("co");
    vi.useRealTimers();
  });

  it("G-02 IndexPagination shows the total and disables the ends", () => {
    const onPageChange = vi.fn();
    render(<IndexPagination page={1} size={20} total={45} onPageChange={onPageChange} onSizeChange={vi.fn()} />);
    expect(screen.getByTestId("index-total")).toHaveTextContent("共 45 筆");
    expect(screen.getByTestId("page-current")).toHaveTextContent("第 1 / 3 頁");
    expect(screen.getByTestId("page-previous")).toBeDisabled();
    fireEvent.click(screen.getByTestId("page-next"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("V2-AC-08 ContextualSaveBar blocks in-app navigation while dirty and saves or discards on request", async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const router = createMemoryRouter(
      [
        {
          path: "/edit",
          element: (
            <>
              <ContextualSaveBar dirty saving={false} onSave={onSave} onDiscard={onDiscard} />
              <Link to="/other">其他頁</Link>
            </>
          ),
        },
        { path: "/other", element: <p>其他</p> },
      ],
      { initialEntries: ["/edit"] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByTestId("save-bar-save"));
    fireEvent.click(screen.getByTestId("save-bar-discard"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "其他頁" }));
    expect(await screen.findByTestId("leave-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("leave-stay"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/edit"));
    fireEvent.click(screen.getByRole("link", { name: "其他頁" }));
    fireEvent.click(await screen.findByTestId("leave-confirm"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/other"));
  });

  it("V2-AC-08 ContextualSaveBar registers beforeunload only while dirty", () => {
    const add = vi.spyOn(window, "addEventListener");
    const router = createMemoryRouter([{ path: "/", element: <ContextualSaveBar dirty={false} saving={false} onSave={vi.fn()} onDiscard={vi.fn()} /> }]);
    render(<RouterProvider router={router} />);
    expect(add.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
    add.mockRestore();
  });

  it("W1-FM08 inside a <form>, the save bar and header actions never submit the form", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const onSave = vi.fn();
    const onAction = vi.fn();
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <form onSubmit={onSubmit}>
            <PageHeader title="甲" primaryAction={{ label: "發布", onSelect: onAction }} />
            <ContextualSaveBar dirty saving={false} onSave={onSave} onDiscard={() => {}} />
          </form>
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByTestId("save-bar-save"));
    fireEvent.click(screen.getByRole("button", { name: "發布" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
