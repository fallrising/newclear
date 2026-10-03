import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { meQueryKey } from "./auth";
import type { Me } from "./types";

export function useUpdateMe(): UseMutationResult<Me, Error, { display_name: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch<Me>("/api/me", { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}

export function useChangeOwnPassword(): UseMutationResult<
  { ok: true },
  Error,
  { memberId: string; old_password: string; new_password: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>("/api/members/" + encodeURIComponent(input.memberId) + "/password", {
        method: "POST",
        body: { old_password: input.old_password, new_password: input.new_password },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}
