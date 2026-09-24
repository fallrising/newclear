import { useQueries } from "@tanstack/react-query";
import { fetchAfterMessages } from "../../api/messages";
import type { RoomSummary } from "../../api/types";
import { useUnreadStore } from "../../store/unread";

export type Unread = { count: number; more: boolean };

export function useUnreadCounts(
  rooms: RoomSummary[] | undefined,
  meId: string,
  activeRoomId: string | null,
): Record<string, Unread> {
  const cursors = useUnreadStore((s) => s.cursors);
  const targets = (rooms ?? []).filter(
    (room) =>
      room.id !== activeRoomId &&
      room.archived_at === null &&
      room.last_seq !== null &&
      cursors[room.id] !== undefined &&
      room.last_seq > cursors[room.id]!,
  );
  const queries = useQueries({
    queries: targets.map((room) => ({
      queryKey: ["unread", room.id, cursors[room.id], room.last_seq],
      staleTime: Infinity,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAfterMessages(room.id, cursors[room.id]!, signal),
    })),
  });
  const out: Record<string, Unread> = {};
  targets.forEach((room, index) => {
    const query = queries[index];
    if (!query?.isSuccess) return;
    out[room.id] = {
      count: query.data.messages.filter((message) => message.sender_id !== meId).length,
      more: query.data.has_more,
    };
  });
  return out;
}
