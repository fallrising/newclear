import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";
import { isApiError, keys } from "@cms/api/public";

/** Never retry a 4xx; retry other failures (5xx, network) up to 2 times. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * A 401 from a query or mutation while signed in marks expiry without clearing the last user.
 * RequireSurface navigates through the router so unsaved changes can block leaving (W1-FM09).
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
      client.setQueryData(keys.auth.expired(), true);
    }
  }
  return client;
}
