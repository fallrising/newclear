import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Provider, ProviderDraft, ProviderTestResult } from "./types";

export const providersQueryKey = ["admin", "providers"] as const;

export function useProviders(): UseQueryResult<{ providers: Provider[]; can_store_secrets: boolean }, Error> {
  return useQuery({
    queryKey: providersQueryKey,
    queryFn: ({ signal }) => apiFetch<{ providers: Provider[]; can_store_secrets: boolean }>("/api/providers", { signal }),
  });
}

export function useProvider(id: string): UseQueryResult<Provider, Error> {
  return useQuery({
    queryKey: [...providersQueryKey, id],
    queryFn: async ({ signal }) => (await apiFetch<{ provider: Provider }>("/api/providers/" + encodeURIComponent(id), { signal })).provider,
  });
}

function invalidateProviders(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: providersQueryKey });
  void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
}

export function useCreateProvider(): UseMutationResult<
  Provider,
  Error,
  ProviderDraft & { name: string; default_quota_class: Provider["default_quota_class"] }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body) => (await apiFetch<{ provider: Provider }>("/api/providers", { method: "POST", body })).provider,
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useUpdateProvider(): UseMutationResult<Provider, Error, { id: string; patch: Record<string, unknown> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) =>
      (await apiFetch<{ provider: Provider }>("/api/providers/" + encodeURIComponent(input.id), { method: "PATCH", body: input.patch })).provider,
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useDeleteProvider(): UseMutationResult<{ ok: true }, Error, { id: string; force: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>(
        "/api/providers/" + encodeURIComponent(input.id) + (input.force ? "?force=1" : ""),
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useTestDraft(): UseMutationResult<ProviderTestResult, Error, ProviderDraft> {
  return useMutation({
    mutationFn: (body) => apiFetch<ProviderTestResult>("/api/providers/test", { method: "POST", body }),
  });
}

export function useTestProvider(): UseMutationResult<ProviderTestResult, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<ProviderTestResult>("/api/providers/" + encodeURIComponent(input.id) + "/test", { method: "POST" }),
    onSuccess: () => invalidateProviders(queryClient),
  });
}
