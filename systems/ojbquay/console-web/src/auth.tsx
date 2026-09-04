import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {createContext, useContext, type PropsWithChildren} from "react";
import {api, ApiError} from "./api";
import type {Actor} from "./types";

interface AuthValue {
  actor: Actor | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({children}: PropsWithChildren) {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Actor>("/api/v1/auth/me"),
    retry: (count, error) =>
      count < 1 && (!(error instanceof ApiError) || error.status >= 500),
  });
  const loginMutation = useMutation({
    mutationFn: (credentials: {username: string; password: string}) =>
      api<Actor>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),
    onSuccess: (actor) => client.setQueryData(["session"], actor),
  });
  const logoutMutation = useMutation({
    mutationFn: () =>
      api<void>("/api/v1/auth/logout", {method: "POST"}),
    onSettled: () => client.setQueryData(["session"], null),
  });
  return (
    <AuthContext.Provider
      value={{
        actor: session.data ?? null,
        loading: session.isLoading,
        login: async (username, password) => {
          await loginMutation.mutateAsync({username, password});
        },
        logout: async () => {
          await logoutMutation.mutateAsync();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("AuthProvider is missing");
  }
  return value;
}
