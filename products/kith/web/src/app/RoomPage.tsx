import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../api/auth";
import { roomsQueryKey, useRoomMembers, useRooms, useUpdateRoom } from "../api/rooms";
import type { Me, RoomSummary } from "../api/types";
import { Composer } from "../features/composer";
import { RoomHeader, RoomNotFound } from "../features/rooms";
import { Timeline } from "../features/timeline";
import { useTimelineStore, useRoomTimeline } from "../store/timeline";
import { readCursor, useUnreadStore } from "../store/unread";
import { useRoomSync } from "../sync/useRoomSync";

function RoomView(props: { room: RoomSummary; me: Me }): ReactElement {
  const { room, me } = props;
  const members = useRoomMembers(room.id);
  const sync = useRoomSync(room.id, me.id);
  const timeline = useRoomTimeline(room.id);
  const updateRoom = useUpdateRoom();
  const [entryCursor] = useState(() => readCursor(room.id));
  const archived = room.archived_at !== null;

  useEffect(() => {
    return () => {
      const current = useTimelineStore.getState().timelines[room.id];
      if (current) useUnreadStore.getState().bump(room.id, current.maxSeq);
    };
  }, [room.id]);

  if (timeline?.phase === "not_found") return <RoomNotFound />;
  const phase = timeline?.phase ?? "loading_latest";
  return (
    <>
      <RoomHeader
        room={room}
        phase={phase}
        archived={archived}
        canUnarchive={me.is_operator === 1}
        onUnarchive={() => updateRoom.mutate({ roomId: room.id, archived: false })}
      />
      {timeline ? (
        <Timeline
          room={room}
          timeline={timeline}
          members={members.data}
          meId={me.id}
          dividerAfterSeq={entryCursor}
          onAtBottom={(atBottom) => {
            if (atBottom) useUnreadStore.getState().bump(room.id, timeline.maxSeq);
          }}
          onLoadOlder={() => sync?.loadOlder()}
          onRetry={(c) => sync?.retry(c)}
          onDiscard={(c) => sync?.discard(c)}
        />
      ) : (
        <div className="flex-1" />
      )}
      <Composer roomId={room.id} roomName={room.name} phase={phase} archived={archived} onSend={(b) => sync?.send(b)} />
    </>
  );
}

export function RoomPage(): ReactElement {
  const { slug } = useParams();
  const rooms = useRooms();
  const me = useMe().data!;
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: roomsQueryKey, exact: true });
  }, [slug, queryClient]);
  if (rooms.isPending) return <div data-testid="room-loading" aria-busy="true" className="flex-1" />;
  if (rooms.isError) return <RoomNotFound />;
  const room = rooms.data.find((r) => r.slug === slug);
  if (!room) return <RoomNotFound />;
  // key: switching rooms rebuilds the view, stopping the old RoomSync (FM-SYNC-10).
  return <RoomView key={room.id} room={room} me={me} />;
}
