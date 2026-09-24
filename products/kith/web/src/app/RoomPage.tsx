import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../api/auth";
import { roomsQueryKey, useRoomMembers, useRooms, useUpdateRoom } from "../api/rooms";
import type { Me, RoomSummary } from "../api/types";
import { useT } from "../copy";
import { Composer } from "../features/composer";
import { TypingIndicator } from "../features/composer/TypingIndicator";
import { InviteDialog } from "../features/console";
import { MembersPanel } from "../features/members";
import { RoomHeader, RoomNotFound } from "../features/rooms";
import { Timeline } from "../features/timeline";
import { useTimelineStore, useRoomTimeline } from "../store/timeline";
import { readCursor, useUnreadStore } from "../store/unread";
import { useRoomSync } from "../sync/useRoomSync";
import { Sheet } from "../ui/Sheet";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function RoomView(props: { room: RoomSummary; me: Me }): ReactElement {
  const t = useT();
  const { room, me } = props;
  const members = useRoomMembers(room.id);
  const sync = useRoomSync(room.id, me.id);
  const timeline = useRoomTimeline(room.id);
  const updateRoom = useUpdateRoom();
  const [entryCursor] = useState(() => readCursor(room.id));
  const [membersOpen, setMembersOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [inviteOpen, setInviteOpen] = useState(false);
  const isLg = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const archived = room.archived_at !== null;
  const operator = me.is_operator === 1;

  useEffect(() => {
    return () => {
      const current = useTimelineStore.getState().timelines[room.id];
      if (current) useUnreadStore.getState().bump(room.id, current.maxSeq);
    };
  }, [room.id]);

  if (timeline?.phase === "not_found") return <RoomNotFound />;
  const phase = timeline?.phase ?? "loading_latest";
  const panel = (
    <MembersPanel room={room} me={me} onClose={() => setMembersOpen(false)} onInvite={() => setInviteOpen(true)} />
  );
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <RoomHeader
          room={room}
          phase={phase}
          archived={archived}
          canUnarchive={operator}
          onUnarchive={() => updateRoom.mutate({ roomId: room.id, archived: false })}
          members={members.data}
          isOperator={operator}
          onOpenMembers={() => setMembersOpen((open) => !open)}
          onInvite={() => setInviteOpen(true)}
        />
        {timeline ? (
          <Timeline
            room={room}
            timeline={timeline}
            members={members.data}
            meId={me.id}
            meHandle={me.handle}
            isOperator={operator}
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
        <TypingIndicator roomId={room.id} members={members.data} meId={me.id} />
        <Composer
          roomId={room.id}
          roomName={room.name}
          phase={phase}
          archived={archived}
          members={members.data}
          viewerIsOperator={operator}
          onSend={(b) => sync?.send(b)}
          onTyping={() => sync?.sendTyping()}
        />
      </div>
      {isLg && membersOpen && (
        <aside data-testid="members-aside" className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface lg:flex">
          {panel}
        </aside>
      )}
      {!isLg && (
        <Sheet
          open={membersOpen}
          onOpenChange={setMembersOpen}
          side={isMobile ? "bottom" : "right"}
          title={t("members.title")}
          data-testid="members-sheet"
        >
          {panel}
        </Sheet>
      )}
      <InviteDialog room={inviteOpen ? room : null} onOpenChange={setInviteOpen} />
    </div>
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
  return <RoomView key={room.id} room={room} me={me} />;
}
