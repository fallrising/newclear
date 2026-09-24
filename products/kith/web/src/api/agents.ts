import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { AdminAgent, AgentDetail, BotToken, PutRuntimeBody, QuotaClass } from "./types";

export const agentsQueryKey = ["admin", "agents"] as const;

function invalidateAgents(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: agentsQueryKey });
  void queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
  void queryClient.invalidateQueries({ queryKey: ["rooms"] });
}

export function useAgents(): UseQueryResult<AdminAgent[], Error> {
  return useQuery({
    queryKey: agentsQueryKey,
    queryFn: async ({ signal }) => (await apiFetch<{ agents: AdminAgent[] }>("/api/agents", { signal })).agents,
  });
}

export function useAgent(id: string): UseQueryResult<AgentDetail, Error> {
  return useQuery({
    queryKey: [...agentsQueryKey, id],
    queryFn: async ({ signal }) => (await apiFetch<{ agent: AgentDetail }>("/api/agents/" + encodeURIComponent(id), { signal })).agent,
  });
}

export function useCreateAgent(): UseMutationResult<
  { id: string; handle: string },
  Error,
  { handle: string; display_name: string; quota_class: QuotaClass }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch<{ id: string; handle: string }>("/api/agents", { method: "POST", body }),
    onSuccess: () => invalidateAgents(queryClient),
  });
}

export function useUpdateAgent(): UseMutationResult<
  AgentDetail,
  Error,
  { id: string; display_name?: string; disabled?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const body: { display_name?: string; disabled?: boolean } = {};
      if (input.display_name !== undefined) body.display_name = input.display_name;
      if (input.disabled !== undefined) body.disabled = input.disabled;
      return (await apiFetch<{ agent: AgentDetail }>("/api/agents/" + encodeURIComponent(input.id), { method: "PATCH", body })).agent;
    },
    onSuccess: () => invalidateAgents(queryClient),
  });
}

export function usePutRuntime(): UseMutationResult<
  { agent: AgentDetail; runtime_epoch: number },
  Error,
  { id: string; body: PutRuntimeBody }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ agent: AgentDetail; runtime_epoch: number }>("/api/agents/" + encodeURIComponent(input.id) + "/runtime", {
        method: "PUT",
        body: input.body,
      }),
    onSuccess: () => invalidateAgents(queryClient),
  });
}

export function useAgentTokens(id: string): UseQueryResult<BotToken[], Error> {
  return useQuery({
    queryKey: [...agentsQueryKey, id, "tokens"],
    queryFn: async ({ signal }) =>
      (await apiFetch<{ tokens: BotToken[] }>("/api/agents/" + encodeURIComponent(id) + "/tokens", { signal })).tokens,
  });
}

export function useIssueToken(): UseMutationResult<{ id: string; token: string }, Error, { agentId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ id: string; token: string }>("/api/agents/" + encodeURIComponent(input.agentId) + "/tokens", { method: "POST" }),
    onSuccess: () => invalidateAgents(queryClient),
  });
}

export function useRevokeToken(): UseMutationResult<{ ok: true }, Error, { agentId: string; tokenId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>(
        "/api/agents/" + encodeURIComponent(input.agentId) + "/tokens/" + encodeURIComponent(input.tokenId),
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateAgents(queryClient),
  });
}
