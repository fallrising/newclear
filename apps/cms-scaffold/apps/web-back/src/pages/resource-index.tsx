import { useCallback } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { workQueries, type WorkContentType, type WorkEntry, type WorkListParams } from "@cms/api";
import { useSession } from "@cms/auth";
import { enumLabel, FieldCell, fieldLabel, formatDateTime } from "@cms/fields";
import { Button, EmptyState, ErrorState, fill, IndexFilters, IndexPagination, IndexTable, PAGE_SIZES, PageHeader, StatusBadge, type IndexColumn } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { can } from "../nav";
import { TypeGate } from "../type-gate";

const TABS = ["all", "draft", "published", "archived"] as const;
const SORTS = [
  { value: "-updatedAt", label: copy["index.sort.updatedDesc"] },
  { value: "updatedAt", label: copy["index.sort.updatedAsc"] },
  { value: "title", label: copy["index.sort.titleAsc"] },
  { value: "-title", label: copy["index.sort.titleDesc"] },
  { value: "-createdAt", label: copy["index.sort.createdDesc"] },
];
const DEFAULT_SORT = "-updatedAt";
const DEFAULT_SIZE = 20;

/** Filterable enum fields get a filter control. Datetime range filters arrive with the W2 schedule view. */
function enumFilters(type: WorkContentType) {
  return type.fields.filter((f) => f.filterable && f.type === "enum" && f.enumValues.length > 0);
}

export interface IndexState {
  tab: (typeof TABS)[number];
  q: string;
  sort: string;
  page: number;
  size: number;
  filter: Record<string, string>;
}

/**
 * URL → index state (01 §4.4: every index setting lives in the URL). Values the UI could not have produced fall
 * back to their defaults, so a hand-edited URL never reaches the API as a 400.
 */
export function readIndexState(type: WorkContentType, params: URLSearchParams): IndexState {
  const tab = (TABS as readonly string[]).includes(params.get("state") ?? "") ? (params.get("state") as IndexState["tab"]) : "all";
  const sort = SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort")! : DEFAULT_SORT;
  const rawPage = params.get("page") ?? "1";
  const pageNumber = Number(rawPage);
  const page = /^\d+$/.test(rawPage) && Number.isSafeInteger(pageNumber) && pageNumber > 0 && pageNumber <= 2147483647 ? pageNumber : 1;
  const size = (PAGE_SIZES as readonly number[]).includes(Number(params.get("size"))) ? Number(params.get("size")) : DEFAULT_SIZE;
  const filter: Record<string, string> = {};
  for (const field of enumFilters(type)) {
    const value = params.get(`filter.${field.key}`);
    if (value && field.enumValues.includes(value)) filter[field.key] = value;
  }
  return { tab, q: (params.get("q") ?? "").trim(), sort, page, size, filter };
}

/** Index state → list request (BW1b §4.3). "all" sends no state, which the API reads as draft,published. */
export function toListParams(state: IndexState): WorkListParams {
  return {
    ...(state.tab === "all" ? {} : { state: state.tab }),
    ...(state.q ? { q: state.q } : {}),
    ...(Object.keys(state.filter).length ? { filter: state.filter } : {}),
    sort: state.sort,
    page: state.page,
    size: state.size,
  };
}

function IndexBody({ type }: { type: WorkContentType }) {
  const me = useSession().me!;
  const [params, setParams] = useSearchParams();
  const state = readIndexState(type, params);
  const entries = useQuery({ ...workQueries.entries(api.work, type.key, toListParams(state)), placeholderData: keepPreviousData });
  const narrowed = state.tab !== "all" || state.q !== "" || Object.keys(state.filter).length > 0;
  const canCreate = can(me, type.key, "create");
  const singletonTaken = type.singleton && (entries.data?.total ?? 0) > 0 && !narrowed;

  // Any change except paging goes back to page 1. Defaults are removed so the URL stays short.
  const update = useCallback(
    (changes: Record<string, string | null>, keepPage = false) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        if (!keepPage) next.delete("page");
        return next;
      });
    },
    [setParams],
  );
  const onQueryChange = useCallback((q: string) => update({ q }), [update]);

  const listable = type.fields.filter((f) => f.listable && f.key !== type.titleField).sort((a, b) => a.order - b.order);
  const columns: IndexColumn<WorkEntry>[] = [
    { key: "title", header: copy["index.col.title"], cell: () => null },
    { key: "status", header: copy["index.col.status"], cell: (e) => <StatusBadge state={e.publicationState} dirty={e.dirty} /> },
    ...listable.map((field) => ({ key: field.key, header: fieldLabel(field), cell: (e: WorkEntry) => <FieldCell field={field} value={e.payload[field.key]} /> })),
    { key: "updatedAt", header: copy["index.col.updated"], cell: (e) => formatDateTime(e.updatedAt), className: "whitespace-nowrap" },
  ];

  const data = entries.data;
  // A page past the end (for example after the last row of a page was archived) moves to the last page.
  if (data && data.items.length === 0 && data.total > 0 && state.page > 1) {
    const last = Math.max(1, Math.ceil(data.total / state.size));
    const next = new URLSearchParams(params);
    if (last === 1) next.delete("page");
    else next.set("page", String(last));
    return <Navigate to={{ search: next.toString() }} replace />;
  }

  const clear = () => setParams(new URLSearchParams());
  const empty = narrowed ? (
    <EmptyState testId="index-no-match" title={copy["index.noMatch"]} description={copy["index.noMatchBody"]} action={<Button variant="outline" onClick={clear}>{copy["index.tab.all"]}</Button>} />
  ) : (
    <EmptyState
      testId="index-empty"
      title={fill(copy["index.empty"], { name: type.pluralDisplayName })}
      description={canCreate ? copy["index.emptyCreate"] : copy["index.emptyReadOnly"]}
      action={canCreate ? <Button asChild><Link to={`/entries/${type.key}/new`}>{fill(copy["index.create"], { name: type.displayName })}</Link></Button> : undefined}
    />
  );

  return (
    <>
      <PageHeader
        title={type.pluralDisplayName}
        primaryAction={canCreate && !singletonTaken ? { label: fill(copy["index.create"], { name: type.displayName }), to: `/entries/${type.key}/new`, testId: "entry-create" } : undefined}
      />
      <IndexFilters
        tabs={TABS.map((tab) => ({ value: tab, label: copy[`index.tab.${tab}`] }))}
        tab={state.tab}
        onTabChange={(tab) => update({ state: tab === "all" ? null : tab })}
        query={state.q}
        onQueryChange={onQueryChange}
        filters={enumFilters(type).map((field) => ({
          key: field.key,
          label: fieldLabel(field),
          options: field.enumValues.map((value) => ({ value, label: enumLabel(field, value) })),
          value: state.filter[field.key] ?? "",
        }))}
        onFilterChange={(key, value) => update({ [`filter.${key}`]: value })}
        sortOptions={SORTS}
        sort={state.sort}
        onSortChange={(sort) => update({ sort: sort === DEFAULT_SORT ? null : sort })}
        onClear={narrowed ? clear : undefined}
      />
      {entries.isError ? (
        <ErrorState onRetry={entries.refetch} />
      ) : (
        <>
          <IndexTable
            columns={columns}
            rows={data?.items}
            rowKey={(e) => e.id}
            rowHref={(e) => `/entries/${type.key}/${e.id}`}
            rowLabel={(e) => e.title || copy["index.untitled"]}
            loading={entries.isPending}
            empty={empty}
          />
          {data && data.total > 0 ? (
            <IndexPagination
              page={state.page}
              size={state.size}
              total={data.total}
              onPageChange={(page) => update({ page: page === 1 ? null : String(page) }, true)}
              onSizeChange={(size) => update({ size: size === DEFAULT_SIZE ? null : String(size) })}
            />
          ) : null}
        </>
      )}
    </>
  );
}

/** 01 §7.2 B-S2: server-paged, filtered and sorted list of one type (G-02). */
export function ResourceIndexPage() {
  const { type = "" } = useParams();
  return <TypeGate type={type}>{(schema) => <IndexBody key={schema.key} type={schema} />}</TypeGate>;
}
