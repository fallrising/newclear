import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { AdminMember } from "./types";

export const adminMembersQueryKey = (kind: "human" | "agent") => ["admin", "members", kind] as const;

export function useAdminMembers(kind: "human" | "agent"): UseQueryResult<AdminMember[], Error> {
  return useQuery({
    queryKey: adminMembersQueryKey(kind),
    queryFn: async ({ signal }) =>
      (
        await apiFetch<{ members: AdminMember[] }>(
          "/api/members?kind=" + kind + "&include_disabled=1&limit=100",
          { signal },
        )
      ).members,
  });
}

export function searchMembers(q: string, signal: AbortSignal): Promise<AdminMember[]> {
  return apiFetch<{ members: AdminMember[] }>("/api/members?q=" + encodeURIComponent(q) + "&limit=10", { signal }).then(
    (res) => res.members,
  );
}

export function useCreateMember(): UseMutationResult<AdminMember, Error, { handle: string; display_name: string; password: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch<AdminMember>("/api/members", { method: "POST", body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "members"] }),
  });
}

export function useUpdateMember(): UseMutationResult<
  AdminMember,
  Error,
  { memberId: string; display_name?: string; disabled?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      const body: { display_name?: string; disabled?: boolean } = {};
      if (input.display_name !== undefined) body.display_name = input.display_name;
      if (input.disabled !== undefined) body.disabled = input.disabled;
      return apiFetch<AdminMember>("/api/members/" + encodeURIComponent(input.memberId), { method: "PATCH", body });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "members"] }),
  });
}

export function useResetPassword(): UseMutationResult<{ ok: true }, Error, { memberId: string; password: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>("/api/members/" + encodeURIComponent(input.memberId) + "/password", {
        method: "POST",
        body: { password: input.password },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "members"] }),
  });
}
