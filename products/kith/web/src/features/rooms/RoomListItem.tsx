import type { ReactElement } from "react";
import { Link } from "react-router";
import type { RoomSummary } from "../../api/types";
import { useLocale, useT } from "../../copy";
import { Badge } from "../../ui/Badge";
import { formatListTime, localTimeZone } from "../../ui/time";
import type { Unread } from "./useUnreadCounts";

export function RoomListItem(props: {
  room: RoomSummary;
  active: boolean;
  unread: Unread | undefined;
  meId: string;
}): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const { room, active, unread } = props;
  const last = room.last_message;
  const senderLabel =
    last === null
      ? ""
      : last.sender_id === props.meId
        ? t("timeline.you")
        : last.sender_display_name || last.sender_handle || t("timeline.unknownSender");
  const previewText = last === null ? "" : senderLabel + ": " + last.body_preview.replace(/\s+/g, " ");
  const nameClass =
    "flex-1 truncate text-md " +
    (unread?.count ? "font-semibold text-ink " : "text-ink ") +
    (active ? "text-accent-strong" : "");
  return (
    <Link
      data-testid="room-list-item"
      data-id={room.id}
      data-slug={room.slug}
      data-unread={unread?.count ?? 0}
      to={"/r/" + room.slug}
      aria-current={active ? "page" : undefined}
      className={
        "mx-2 my-0.5 flex flex-col gap-0.5 rounded-md px-3 py-2 hover:bg-surface " +
        (active ? "bg-accent-tint border-l-2 border-accent" : "")
      }
    >
      <div className="flex items-center gap-2">
        <span className="text-ink-3">#</span>
        <span data-testid="room-list-name" className={nameClass}>
          {room.name}
        </span>
        {last && (
          <time data-testid="room-list-time" data-mask="time" className="text-xs text-ink-3">
            {formatListTime(last.created_at, locale, new Date(), localTimeZone())}
          </time>
        )}
        {unread && unread.count > 0 && (
          <Badge tone="accent" data-testid="room-list-unread">
            {unread.more ? "50+" : unread.count}
          </Badge>
        )}
      </div>
      {last && (
        <p data-testid="room-list-preview" className="truncate text-sm text-ink-2">
          {previewText}
        </p>
      )}
    </Link>
  );
}
