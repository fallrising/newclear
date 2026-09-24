import type { ReactElement } from "react";
import { useParams } from "react-router";
import { useMe } from "../api/auth";
import { useRoomMembers, useRooms } from "../api/rooms";
import type { Me, Room } from "../api/types";
import { Composer } from "../features/composer";
import { RoomHeader, RoomNotFound } from "../features/rooms";
import { Timeline } from "../features/timeline";
import { useRoomTimeline } from "../store/timeline";
import { useRoomSync } from "../sync/useRoomSync";

function RoomView(props: { room: Room; me: Me }): ReactElement {
  const { room, me } = props;
  const members = useRoomMembers(room.id);
  const sync = useRoomSync(room.id, me.id);
  const timeline = useRoomTimeline(room.id);
  if (timeline?.phase === "not_found") return <RoomNotFound />;
  const phase = timeline?.phase ?? "loading_latest";
  return (
    <>
      <RoomHeader room={room} phase={phase} />
      {timeline ? (
        <Timeline
          room={room}
          timeline={timeline}
          members={members.data}
          meId={me.id}
          onLoadOlder={() => sync?.loadOlder()}
          onRetry={(c) => sync?.retry(c)}
          onDiscard={(c) => sync?.discard(c)}
        />
      ) : (
        <div className="flex-1" />
      )}
      <Composer roomId={room.id} roomName={room.name} phase={phase} onSend={(b) => sync?.send(b)} />
    </>
  );
}

export function RoomPage(): ReactElement {
  const { slug } = useParams();
  const rooms = useRooms();
  const me = useMe().data!;
  if (rooms.isPending) return <div data-testid="room-loading" aria-busy="true" className="flex-1" />;
  if (rooms.isError) return <RoomNotFound />;
  const room = rooms.data.find((r) => r.slug === slug);
  if (!room) return <RoomNotFound />;
  // key: switching rooms rebuilds the view, stopping the old RoomSync (FM-SYNC-10).
  return <RoomView key={room.id} room={room} me={me} />;
}
