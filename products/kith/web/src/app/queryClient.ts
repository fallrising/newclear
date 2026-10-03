import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";

function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) return false;
  return failureCount < 2;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function createQueryClient(): QueryClient {
  let client: QueryClient;

  /** Session lost: drop everything except `me`, and refetch `me` so RequireAuth sends the user to /login. */
  const onAuthLost = (): void => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    void client.invalidateQueries({ queryKey: ["me"] });
  };

  client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // `me` handles its own 401 in RequireAuth; reacting here too would refetch forever.
        if (isUnauthorized(error) && query.queryKey[0] !== "me") onAuthLost();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (isUnauthorized(error) && mutation.meta?.authFlow !== true) onAuthLost();
      },
    }),
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  return client;
}
