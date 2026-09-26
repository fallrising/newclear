import { X } from "lucide-react";
import { useEffect, type ReactElement } from "react";
import { useThread } from "../../api/rooms";
import type { Me, RoomMember, RoomSummary, ServerMessage } from "../../api/types";
import { useT } from "../../copy";
import { Composer } from "../composer";
import { MessageRow } from "../timeline/MessageRow";
import { TraceCard } from "../timeline/TraceCard";
import type { TimelineItem } from "../timeline/buildItems";
import { displayName } from "../../ui/displayName";
import { IconButton } from "../../ui/IconButton";
import type { PendingSend, RoomTimeline, SyncPhase } from "../../sync/types";

type Props = {
  room: RoomSummary;
  rootId: string;
  me: Me;
  members: RoomMember[] | undefined;
  timeline: RoomTimeline | undefined;
  phase: SyncPhase;
  archived: boolean;
  onClose: () => void;
  onSend: (body: string) => void;
  onTyping: () => void;
  onRetry: (cmid: string) => void;
  onDiscard: (cmid: string) => void;
};

function rowsFor(timeline: RoomTimeline | undefined, rootId: string): ServerMessage[] {
  if (!timeline) return [];
  const rows: ServerMessage[] = [];
  for (const seq of timeline.seqs) {
    const row = timeline.rows[seq];
    if (row && (row.id === rootId || row.thread_id === rootId)) rows.push(row);
  }
  return rows;
}

/** Store when the root is loaded; otherwise the thread query merged with live rows of this root. */
function mergedRows(timeline: RoomTimeline | undefined, fetched: ServerMessage[] | undefined, rootId: string, fromStore: boolean): ServerMessage[] {
  if (fromStore) return rowsFor(timeline, rootId);
  const bySeq = new Map<number, ServerMessage>();
  for (const row of fetched ?? []) {
    if (row.id === rootId || row.thread_id === rootId) bySeq.set(row.seq, row);
  }
  for (const row of rowsFor(timeline, rootId)) bySeq.set(row.seq, row);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function ThreadPanel(props: Props): ReactElement {
  const t = useT();
  const { room, rootId, me } = props;
  const rootInStore = props.timeline ? rowsFor(props.timeline, rootId).some((row) => row.id === rootId) : false;
  const fetched = useThread(room.id, rootId, !rootInStore);
  const notFound = !rootInStore && fetched.isSuccess && (fetched.data?.length ?? 0) === 0;
  const rows = mergedRows(props.timeline, fetched.data, rootId, rootInStore);
  const root = rows.find((row) => row.id === rootId) ?? null;
  const replies = rows.filter((row) => row.thread_id === rootId);
  const pending = (props.timeline?.pending ?? []).filter((item) => item.threadId === rootId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  return (
    <section data-testid="thread-panel" data-root={rootId} aria-label={t("thread.title")} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-lg font-semibold text-ink">{t("thread.title")}</h2>
        <IconButton data-testid="thread-close" label={t("thread.close")} icon={X} onClick={props.onClose} />
      </header>
      {notFound ? (
        <p data-testid="thread-not-found" className="px-4 py-3 text-sm text-ink-2">
          {t("thread.notFound")}
        </p>
      ) : root ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div data-testid="thread-root">
              <ThreadMessage
                row={root}
                room={room}
                me={me}
                members={props.members}
                onRetry={props.onRetry}
                onDiscard={props.onDiscard}
              />
            </div>
            <ol data-testid="thread-replies">
              {replies.map((row) => (
                <li key={row.id}>
                  {row.kind === "trace" ? (
                    <TraceCard
                      roomId={room.id}
                      row={row}
                      senderName={nameOf(props.members, row.sender_id, t("timeline.unknownSender"))}
                    />
                  ) : (
                    <ThreadMessage
                      row={row}
                      room={room}
                      me={me}
                      members={props.members}
                      onRetry={props.onRetry}
                      onDiscard={props.onDiscard}
                    />
                  )}
                </li>
              ))}
              {pending.map((item) => (
                <li key={item.clientMessageId}>
                  <ThreadPending
                    pending={item}
                    room={room}
                    me={me}
                    members={props.members}
                    onRetry={props.onRetry}
                    onDiscard={props.onDiscard}
                  />
                </li>
              ))}
            </ol>
          </div>
          <Composer
            key={rootId}
            roomId={room.id}
            roomName={room.name}
            phase={props.phase}
            archived={props.archived}
            members={props.members}
            viewerIsOperator={me.is_operator === 1}
            threadId={rootId}
            testIdPrefix="thread-"
            onSend={props.onSend}
            onTyping={props.onTyping}
          />
        </>
      ) : (
        <div className="flex-1" aria-busy="true" />
      )}
    </section>
  );
}

function nameOf(members: RoomMember[] | undefined, id: string, unknown: string): string {
  const member = members?.find((item) => item.id === id);
  return member ? displayName(member) : unknown;
}

function ThreadMessage(props: {
  row: ServerMessage;
  room: RoomSummary;
  me: Me;
  members: RoomMember[] | undefined;
  onRetry: (cmid: string) => void;
  onDiscard: (cmid: string) => void;
}): ReactElement {
  const item: Extract<TimelineItem, { kind: "message" }> = {
    kind: "message",
    key: "s:" + props.row.seq,
    row: props.row,
    groupHead: true,
    replyCount: 0,
    lastReplyAt: null,
  };
  const sender = props.members?.find((member) => member.id === props.row.sender_id);
  return (
    <MessageRow
      item={item}
      sender={sender}
      senderId={props.row.sender_id}
      isMe={props.row.sender_id === props.me.id}
      mentionHandles={props.members?.map((member) => member.handle) ?? []}
      meHandle={props.me.handle}
      isOperator={props.me.is_operator === 1}
      onRetry={props.onRetry}
      onDiscard={props.onDiscard}
      roomSlug={props.room.slug}
      roomId={props.room.id}
    />
  );
}

function ThreadPending(props: {
  pending: PendingSend;
  room: RoomSummary;
  me: Me;
  members: RoomMember[] | undefined;
  onRetry: (cmid: string) => void;
  onDiscard: (cmid: string) => void;
}): ReactElement {
  const item: Extract<TimelineItem, { kind: "pending" }> = {
    kind: "pending",
    key: "p:" + props.pending.clientMessageId,
    pending: props.pending,
    groupHead: true,
  };
  const sender = props.members?.find((member) => member.id === props.me.id);
  return (
    <MessageRow
      item={item}
      sender={sender}
      senderId={props.me.id}
      isMe
      mentionHandles={props.members?.map((member) => member.handle) ?? []}
      meHandle={props.me.handle}
      isOperator={props.me.is_operator === 1}
      onRetry={props.onRetry}
      onDiscard={props.onDiscard}
      roomSlug={props.room.slug}
      roomId={props.room.id}
    />
  );
}
