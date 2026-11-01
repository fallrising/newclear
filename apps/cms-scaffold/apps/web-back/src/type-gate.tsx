import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isApiError, workQueries, type WorkContentType } from "@cms/api";
import { useSession } from "@cms/auth";
import { DefaultSkeleton, ErrorState } from "@cms/ui";
import { api } from "./api";
import { can } from "./nav";

/**
 * Loads the type schema and applies 01 §8: unknown type → /not-found; known but no read_draft → /forbidden.
 * The redirect replaces the history entry, so Back returns to the page before.
 */
export function TypeGate({ type, children }: { type: string; children: (schema: WorkContentType) => ReactNode }) {
  const me = useSession().me!;
  const schema = useQuery(workQueries.type(api.work, type));
  if (schema.isPending) return <DefaultSkeleton />;
  if (schema.isError && !schema.data) {
    if (isApiError(schema.error) && schema.error.status === 404) return <Navigate to="/not-found" replace />;
    if (isApiError(schema.error) && schema.error.status === 403) return <Navigate to="/forbidden" replace />;
    return <ErrorState onRetry={schema.refetch} />;
  }
  if (!can(me, type, "read_draft")) return <Navigate to="/forbidden" replace />;
  return <>{children(schema.data)}</>;
}
