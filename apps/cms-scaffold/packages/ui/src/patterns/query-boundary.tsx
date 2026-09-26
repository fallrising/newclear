import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { uiCopy } from "../copy";

/** The part of a TanStack Query result that QueryBoundary reads (kept structural so @cms/ui does not depend on @cms/api). */
export interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  refetch: () => unknown;
}

export interface QueryBoundaryProps<T> {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  /** Shown while pending. Defaults to three skeleton lines. */
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  /** Shown when isEmpty(data) is true. Never shown while loading (C-02). */
  empty?: ReactNode;
  /** Shown when the error has status 404. Without it a 404 renders the generic error. */
  notFound?: ReactNode;
}

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : undefined;
}

export function DefaultSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="query-loading" aria-busy="true" aria-label={uiCopy["ui.loading"]}>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => unknown }) {
  return (
    <Alert variant="destructive" data-testid="query-error">
      <AlertTitle>{uiCopy["ui.error.title"]}</AlertTitle>
      <AlertDescription>
        <p>{uiCopy["ui.error.body"]}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => onRetry()} data-testid="query-retry">
          {uiCopy["ui.error.retry"]}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function QueryBoundary<T>({ query, children, skeleton, isEmpty, empty, notFound }: QueryBoundaryProps<T>) {
  if (query.isPending) return <>{skeleton ?? <DefaultSkeleton />}</>;
  if (query.isError) {
    if (notFound !== undefined && statusOf(query.error) === 404) return <>{notFound}</>;
    return <ErrorState onRetry={query.refetch} />;
  }
  const data = query.data as T;
  if (empty !== undefined && isEmpty?.(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}
