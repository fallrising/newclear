import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Room, RoomMember, RoomMembersResponse, RoomsResponse } from "./types";

export const roomsQueryKey = ["rooms"] as const;
export const roomMembersQueryKey = (roomId: string) => ["rooms", roomId, "members"] as const;

export function useRooms(): UseQueryResult<Room[], Error> {
  return useQuery({
    queryKey: roomsQueryKey,
    queryFn: async ({ signal }) => (await apiFetch<RoomsResponse>("/api/rooms", { signal })).rooms,
    staleTime: 30_000,
  });
}

export function useRoomMembers(roomId: string): UseQueryResult<RoomMember[], Error> {
  return useQuery({
    queryKey: roomMembersQueryKey(roomId),
    queryFn: async ({ signal }) =>
      (await apiFetch<RoomMembersResponse>(`/api/rooms/${encodeURIComponent(roomId)}/members`, { signal })).members,
  });
}
