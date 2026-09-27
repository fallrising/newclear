import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, type AuthApi, type Me } from "@cms/api/public";

export type SessionStatus = "loading" | "anonymous" | "authenticated" | "error";

export interface Session {
  status: SessionStatus;
  me: Me | null;
  retry: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** Reads /auth/me once per page load (C-17). A 401 means anonymous, not an error. */
export function SessionProvider({ auth, children }: { auth: AuthApi; children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.auth.me(),
    queryFn: async ({ signal }): Promise<Me | null> => {
      try {
        return await auth.me(signal);
      } catch (error) {
        if (isApiError(error) && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      queryClient.setQueryData(keys.auth.me(), null);
    }
  }, [auth, queryClient]);
  const value = useMemo<Session>(() => {
    const status: SessionStatus = query.isPending ? "loading" : query.isError ? "error" : query.data ? "authenticated" : "anonymous";
    return { status, me: query.data ?? null, retry: () => void query.refetch(), signOut };
  }, [query, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}

/** Null outside a SessionProvider (web-front in W0 has none). */
export function useOptionalSession(): Session | null {
  return useContext(SessionContext);
}
