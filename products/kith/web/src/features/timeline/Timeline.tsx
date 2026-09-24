import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { Room, RoomMember } from "../../api/types";
import { useT } from "../../copy";
import type { RoomTimeline } from "../../sync/types";
import { localTimeZone } from "../../ui/time";
import { buildItems, type TimelineItem } from "./buildItems";
import { DateDivider } from "./DateDivider";
import { JumpToLatest } from "./JumpToLatest";
import { MessageRow } from "./MessageRow";
import { SyncNotice } from "./SyncNotice";
import { TimelineTop } from "./TimelineTop";

type Props = {
  room: Room;
  timeline: RoomTimeline;
  members: RoomMember[] | undefined;
  meId: string;
  onLoadOlder(): void;
  onRetry(cmid: string): void;
  onDiscard(cmid: string): void;
};

const BOTTOM_PX = 80;
const LOAD_OLDER_PX = 200;

export function Timeline(props: Props): ReactElement {
  const t = useT();
  const { timeline, meId } = props;
  const items = useMemo(
    () => buildItems(timeline, meId, localTimeZone()),
    [timeline.seqs, timeline.rows, timeline.pending, meId],
  );
  const hasMessages = items.some((i) => i.kind === "message");

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const initialScrolled = useRef(false);
  const [unseen, setUnseen] = useState(0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (i) => items[i]!.key,
  });

  const scrollToEnd = (): void => {
    if (items.length > 0) virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  };

  const atBottom = (): boolean => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PX;
  };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = atBottom();
    if (atBottomRef.current) setUnseen(0);
    if (initialScrolled.current && el.scrollTop < LOAD_OLDER_PX) props.onLoadOlder();
  };

  // 3. First time there are messages: open at the latest one.
  useEffect(() => {
    if (initialScrolled.current || !hasMessages) {
      if (!hasMessages && timeline.phase !== "loading_latest") initialScrolled.current = true;
      return;
    }
    scrollToEnd();
    const id = requestAnimationFrame(() => {
      scrollToEnd();
      initialScrolled.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [hasMessages, timeline.phase]);

  // 4. Keep the anchor when older rows are prepended (W1 §5.6.2; measured 0 px jump).
  const firstKey = items[1]?.key ?? null;
  const lastKey = items[items.length - 1]?.key ?? null;
  const prevFirstKey = useRef<string | null>(null);
  const prevLastKey = useRef<string | null>(null);
  const prevTotal = useRef(0);
  const prevItems = useRef<TimelineItem[]>(items);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const total = virtualizer.getTotalSize();
    if (el && prevFirstKey.current !== null && firstKey !== prevFirstKey.current && prevLastKey.current === lastKey) {
      el.scrollTop += total - prevTotal.current;
    }
    prevFirstKey.current = firstKey;
    prevLastKey.current = lastKey;
    prevTotal.current = total;
  });

  // 5. Items appended at the end.
  useEffect(() => {
    const before = prevItems.current;
    prevItems.current = items;
    if (!initialScrolled.current) return;
    const oldLast = before[before.length - 1]?.key;
    if (oldLast === lastKey) return;
    const idx = oldLast === undefined ? -1 : items.findIndex((i) => i.key === oldLast);
    const added = idx >= 0 ? items.slice(idx + 1) : items.slice(-1);
    if (added.length === 0) return;
    const mine = added.some(
      (i) => i.kind === "pending" || (i.kind === "message" && i.row.sender_id === meId),
    );
    if (mine || atBottomRef.current) {
      scrollToEnd();
      requestAnimationFrame(scrollToEnd);
    } else {
      const n = added.filter((i) => i.kind === "message").length;
      if (n > 0) setUnseen((u) => u + n);
    }
  }, [lastKey]);

  const renderItem = (item: TimelineItem): ReactElement => {
    switch (item.kind) {
      case "top":
        return <TimelineTop timeline={timeline} room={props.room} hasMessages={hasMessages} onRetry={props.onLoadOlder} />;
      case "date":
        return <DateDivider date={item.date} />;
      case "message": {
        const sender = props.members?.find((m) => m.id === item.row.sender_id);
        return (
          <MessageRow
            item={item}
            sender={sender}
            senderId={item.row.sender_id}
            isMe={item.row.sender_id === meId}
            onRetry={props.onRetry}
            onDiscard={props.onDiscard}
          />
        );
      }
      case "pending": {
        const sender = props.members?.find((m) => m.id === meId);
        return <MessageRow item={item} sender={sender} senderId={meId} isMe onRetry={props.onRetry} onDiscard={props.onDiscard} />;
      }
    }
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        data-testid="timeline"
        role="log"
        aria-live="polite"
        aria-label={t("timeline.label", { room: props.room.name })}
        className="h-full overflow-y-auto"
        style={{ overflowAnchor: "none" }}
        onScroll={onScroll}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }}
            >
              {renderItem(items[v.index]!)}
            </div>
          ))}
        </div>
      </div>
      <SyncNotice roomId={props.room.id} jumped={timeline.jumped} />
      <JumpToLatest
        count={unseen}
        onClick={() => {
          scrollToEnd();
          setUnseen(0);
        }}
      />
    </div>
  );
}
