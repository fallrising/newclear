import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { apiFetch } from "./client";
import type { LoginRequest, LoginResponse, LogoutResponse, Me } from "./types";

export const meQueryKey = ["me"] as const;

export function useMe(): UseQueryResult<Me, Error> {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => apiFetch<Me>("/api/me", { signal }),
    staleTime: 60_000,
  });
}

export function useLogin(): UseMutationResult<LoginResponse, Error, LoginRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: LoginRequest) => apiFetch<LoginResponse>("/api/auth/login", { method: "POST", body: req }),
    meta: { authFlow: true },
    onSuccess: (res) => queryClient.setQueryData(meQueryKey, res.member),
  });
}

export function useLogout(): UseMutationResult<LogoutResponse, Error, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiFetch<LogoutResponse>("/api/auth/logout", { method: "POST" }),
    meta: { authFlow: true },
    onSettled: () => {
      queryClient.clear();
      void navigate("/login", { replace: true });
    },
  });
}
