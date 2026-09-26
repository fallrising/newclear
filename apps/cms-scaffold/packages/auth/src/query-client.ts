import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";
import { isApiError, keys } from "@cms/api/public";

/** Never retry a 4xx; retry other failures (5xx, network) up to 2 times. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * QueryClient used by all three apps. A 401 from any query or mutation (session expired) marks the
 * session anonymous; RequireSurface then redirects to the login page with the current path (C-17).
 */
export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => onUnauthorized(error) }),
    mutationCache: new MutationCache({ onError: (error) => onUnauthorized(error) }),
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  function onUnauthorized(error: unknown) {
    if (isApiError(error) && error.status === 401 && client.getQueryData(keys.auth.me())) {
      client.setQueryData(keys.auth.me(), null);
    }
  }
  return client;
}
