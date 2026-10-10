import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, fill, Skeleton, TitleSuffixContext, type QueryLike } from "@cms/ui";
import { copy } from "./copy";
import { usePageMeta } from "./seo";
import { FrontTitle, SkipLink, useSite } from "./shell";

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : undefined;
}

/** surface-front §4.5, §7.5: 404, and 403 on a content route, render the same NotFoundPublic (nothing leaks). */
export function isNotPublic(error: unknown): boolean {
  const status = statusOf(error);
  return status === 404 || status === 403;
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <div data-testid="query-loading" aria-busy="true" aria-label={copy["loading"]}>
      {children}
    </div>
  );
}

/** Placeholder with the layout of a card grid (01 §7.1 F-S6): never the empty copy while loading (C-02). */
export function GridSkeleton({ square = false }: { square?: boolean }) {
  return (
    <Loading>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className={square ? "aspect-square w-full" : "aspect-[4/3] w-full"} />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Clinic profile: title, one-line intro and the existing three contact cards. */
export function ClinicProfileSkeleton() {
  return (
    <Loading>
      <section className="mb-10" data-testid="clinic-profile-loading" aria-busy="true">
        <div className="mb-6"><Skeleton className="h-10 w-1/2" /></div>
        <Skeleton className="mb-6 h-[26px] w-2/3" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="gap-2">
              <CardHeader><CardTitle><Skeleton className="h-4 w-20" /></CardTitle></CardHeader>
              <CardContent><Skeleton className="h-[26px] w-2/3" /></CardContent>
            </Card>
          ))}
        </div>
      </section>
    </Loading>
  );
}

/** Vets without photos use compact text cards, rather than a square media placeholder. */
export function VetGridSkeleton() {
  return (
    <Loading>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="h-full gap-4 overflow-hidden">
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-[30px] w-2/3" />
              <div className="flex h-[26px] items-center"><Skeleton className="h-[22px] w-12" /></div>
              <Skeleton className="h-[26px] w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </Loading>
  );
}

/** Placeholder with the layout of a detail page: breadcrumb, title, media, text. */
export function DetailSkeleton() {
  return (
    <Loading>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="aspect-[4/3] w-full max-w-3xl" />
        <Skeleton className="h-4 w-full max-w-[68ch]" />
      </div>
    </Loading>
  );
}

/** Heading-sized placeholder for a site home hero or profile. */
export function HeroSkeleton() {
  return (
    <Loading>
      <div className="mb-10 flex flex-col gap-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </Loading>
  );
}

export function EmptyPublished({ title, description }: { title: string; description?: string }) {
  return <EmptyState title={title} description={description} testId="empty-published" />;
}

/** 404, unpublished, deleted, unknown slug, private project, unknown path: one screen (surface-front §4.5, AC-07). */
export function NotFoundPublic() {
  const site = useSite();
  usePageMeta({ title: copy["notfound"], index: false });
  return (
    <div data-testid="not-found-public">
      <FrontTitle>{copy["notfound"]}</FrontTitle>
      <p className="mb-6 text-subdued">{copy["notfound.body"]}</p>
      {site ? (
        <Link to={site.basePath} className="underline">
          {fill(copy["notfound.home"], { site: site.name })}
        </Link>
      ) : (
        <Link to="/" className="underline">
          {copy["notfound.selector"]}
        </Link>
      )}
    </div>
  );
}

/** NotFoundPublic for paths outside the three sites, with the selector's chrome. */
export function StandaloneNotFound() {
  return (
    <TitleSuffixContext.Provider value={copy["selector.title"]}>
      <div data-scheme="selector" className="min-h-screen bg-page text-foreground text-front-body">
        <SkipLink />
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-12 outline-none">
          <NotFoundPublic />
        </main>
      </div>
    </TitleSuffixContext.Provider>
  );
}

function PageError({ onRetry }: { onRetry: () => unknown }) {
  usePageMeta({ title: copy["error.title"], index: false });
  return (
    <div data-testid="error-public">
      <FrontTitle>{copy["error.title"]}</FrontTitle>
      <p className="mb-4 text-subdued">{copy["error.body"]}</p>
      <Button onClick={() => onRetry()} data-testid="error-retry">
        {copy["error.retry"]}
      </Button>
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => unknown }) {
  return (
    <Alert data-testid="error-public">
      <AlertTitle>{copy["error.title"]}</AlertTitle>
      <AlertDescription>
        <p>{copy["error.body"]}</p>
        <Button variant="outline" className="mt-2" onClick={() => onRetry()} data-testid="error-retry">
          {copy["error.retry"]}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** C-03: 5xx and network errors show ErrorPublic with a retry button, never the not-found screen. */
export function ErrorPublic({ level, onRetry }: { level: "page" | "section"; onRetry: () => unknown }) {
  return level === "page" ? <PageError onRetry={onRetry} /> : <SectionError onRetry={onRetry} />;
}

export interface PublicBoundaryProps<T> {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  /**
   * "page": the page's own entry — 404/403 → NotFoundPublic, other errors → full-page ErrorPublic.
   * "section": a list inside a page — any error → ErrorPublic in place; the page keeps its heading and meta.
   */
  level: "page" | "section";
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}

/** Loading → skeleton; error → NotFoundPublic or ErrorPublic; empty → `empty`; else children (01 §7.1 F-S6). */
export function PublicBoundary<T>({ query, children, level, skeleton, isEmpty, empty }: PublicBoundaryProps<T>) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError) {
    if (level === "page" && isNotPublic(query.error)) return <NotFoundPublic />;
    return <ErrorPublic level={level} onRetry={query.refetch} />;
  }
  const data = query.data as T;
  if (empty !== undefined && isEmpty?.(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}

/** `?page=` as a positive integer; anything else is page 1. */
export function readPage(params: URLSearchParams): number {
  const raw = params.get("page");
  return raw !== null && /^[1-9][0-9]{0,5}$/.test(raw) ? Number(raw) : 1;
}

/** Search string for page `n` keeping the other parameters; page 1 drops the parameter. */
export function pageSearch(params: URLSearchParams, n: number): string {
  const next = new URLSearchParams(params);
  if (n <= 1) next.delete("page");
  else next.set("page", String(n));
  const query = next.toString();
  return query ? `?${query}` : "";
}

/** Previous / next links for a paged public list; nothing when everything fits on one page. */
export function ListPager({ page, size, total }: { page: number; size: number; total: number }) {
  const [params] = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <nav aria-label={copy["pager.label"]} className="mt-8 flex items-center justify-center gap-6" data-testid="list-pager">
      {page > 1 ? (
        <Link to={{ search: pageSearch(params, page - 1) }} className="underline" data-testid="pager-previous">
          {copy["pager.previous"]}
        </Link>
      ) : null}
      <span className="text-subdued">{fill(copy["pager.page"], { page, pages })}</span>
      {page < pages ? (
        <Link to={{ search: pageSearch(params, page + 1) }} className="underline" data-testid="pager-next">
          {copy["pager.next"]}
        </Link>
      ) : null}
    </nav>
  );
}
