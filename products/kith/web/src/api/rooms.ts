import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";
import type { AttentionUpdate, MessagesPage, RoomMember, RoomMembersResponse, RoomSummary, RoomsResponse, ServerMessage } from "./types";

export const roomsQueryKey = ["rooms"] as const;
export const allRoomsQueryKey = ["rooms", "all"] as const;
export const roomMembersQueryKey = (roomId: string) => ["rooms", roomId, "members"] as const;

export function useRooms(): UseQueryResult<RoomSummary[], Error> {
  return useQuery({
    queryKey: roomsQueryKey,
    queryFn: async ({ signal }) => (await apiFetch<RoomsResponse>("/api/rooms", { signal })).rooms,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useAllRooms(): UseQueryResult<RoomSummary[], Error> {
  return useQuery({
    queryKey: allRoomsQueryKey,
    queryFn: async ({ signal }) => (await apiFetch<RoomsResponse>("/api/rooms?all=1", { signal })).rooms,
  });
}

export function useCreateRoom(): UseMutationResult<
  { id: string; slug: string; name: string; created_at: string },
  Error,
  { slug: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiFetch<{ id: string; slug: string; name: string; created_at: string }>("/api/rooms", { method: "POST", body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["rooms"] }),
  });
}

export function useUpdateRoom(): UseMutationResult<RoomSummary, Error, { roomId: string; name?: string; archived?: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      const body: { name?: string; archived?: boolean } = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.archived !== undefined) body.archived = input.archived;
      return apiFetch<RoomSummary>("/api/rooms/" + encodeURIComponent(input.roomId), { method: "PATCH", body });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["rooms"] }),
  });
}

export function useInviteMember(): UseMutationResult<
  { ok: true; member_id: string; role: string },
  Error,
  { roomId: string; handle: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true; member_id: string; role: string }>("/api/rooms/" + encodeURIComponent(input.roomId) + "/members", {
        method: "POST",
        body: { handle: input.handle },
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      void queryClient.invalidateQueries({ queryKey: roomMembersQueryKey(input.roomId) });
    },
  });
}

export function useRemoveMember(): UseMutationResult<{ ok: true }, Error, { roomId: string; memberId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>(
        "/api/rooms/" + encodeURIComponent(input.roomId) + "/members/" + encodeURIComponent(input.memberId),
        { method: "DELETE" },
      ),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      void queryClient.invalidateQueries({ queryKey: roomMembersQueryKey(input.roomId) });
    },
  });
}

export function useUpdateAttention(): UseMutationResult<
  { ok: true },
  Error,
  { roomId: string; memberId: string; update: AttentionUpdate }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>(
        "/api/rooms/" + encodeURIComponent(input.roomId) + "/members/" + encodeURIComponent(input.memberId) + "/attention",
        { method: "PATCH", body: input.update },
      ),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: roomMembersQueryKey(input.roomId) });
    },
  });
}

/** Deep link or a root older than the timeline window. Later replies arrive through RoomSync. */
export function useThread(roomId: string, rootId: string, enabled = true): UseQueryResult<ServerMessage[], Error> {
  return useQuery({
    queryKey: ["rooms", roomId, "thread", rootId],
    enabled,
    queryFn: async ({ signal }) => {
      const page = await apiFetch<MessagesPage>(
        `/api/rooms/${encodeURIComponent(roomId)}/messages?thread_id=${encodeURIComponent(rootId)}&kind=message,trace&order=asc&limit=50`,
        { signal },
      );
      return page.messages;
    },
  });
}

/** Full trace text. 404 (not a trace, or no full text stored) is null. */
export async function fetchTraceFull(roomId: string, messageId: string): Promise<string | null> {
  try {
    const res = await apiFetch<{ message_id: string; body: string }>(
      "/api/rooms/" + encodeURIComponent(roomId) + "/traces/" + encodeURIComponent(messageId),
    );
    return res.body;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function useRoomMembers(roomId: string): UseQueryResult<RoomMember[], Error> {
  return useQuery({
    queryKey: roomMembersQueryKey(roomId),
    queryFn: async ({ signal }) =>
      (await apiFetch<RoomMembersResponse>(`/api/rooms/${encodeURIComponent(roomId)}/members`, { signal })).members,
    refetchInterval: 4_000,
  });
}
