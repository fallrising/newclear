import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import { useMe } from "../../api/auth";
import { useRooms } from "../../api/rooms";
import type { RoomSummary } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { useRoomNav } from "../../store/roomNav";
import { initCursors } from "../../store/unread";
import { RoomListItem } from "./RoomListItem";
import { useUnreadCounts } from "./useUnreadCounts";

function byRecent(a: RoomSummary, b: RoomSummary): number {
  const aAt = a.last_message?.created_at;
  const bAt = b.last_message?.created_at;
  if (aAt && bAt && aAt !== bAt) return aAt < bAt ? 1 : -1;
  if (aAt && !bAt) return -1;
  if (!aAt && bAt) return 1;
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? 1 : -1;
}

export function RoomList(): ReactElement {
  const t = useT();
  const rooms = useRooms();
  const me = useMe().data;
  const { slug } = useParams();
  const [query, setQuery] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const activeId = rooms.data?.find((room) => room.slug === slug)?.id ?? null;
  const unread = useUnreadCounts(rooms.data, me?.id ?? "", activeId);
  const needle = query.trim().toLowerCase();
  const filtered = (rooms.data ?? []).filter((room) => room.name.toLowerCase().includes(needle));
  const openRooms = filtered.filter((room) => room.archived_at === null).sort(byRecent);
  const archivedRooms = filtered
    .filter((room) => room.archived_at !== null)
    .sort((a, b) => ((a.archived_at ?? "") < (b.archived_at ?? "") ? 1 : -1));
  const orderKey = openRooms.map((room) => room.slug).join("\n");
  const unreadKey = openRooms
    .filter((room) => {
      const mark = unread[room.id];
      return mark !== undefined && (mark.count > 0 || mark.more);
    })
    .map((room) => room.slug)
    .join("\n");

  useEffect(() => {
    useRoomNav.getState().set(orderKey === "" ? [] : orderKey.split("\n"), unreadKey === "" ? [] : unreadKey.split("\n"));
  }, [orderKey, unreadKey]);

  useEffect(() => {
    if (rooms.data) initCursors(rooms.data);
  }, [rooms.data]);

  if (rooms.isPending || !me) {
    return (
      <div data-testid="room-list-loading" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 rounded-md bg-surface mx-2 my-1" />
        ))}
      </div>
    );
  }
  if (rooms.isError) {
    return (
      <div>
        <div data-testid="room-list-error" role="alert" className="px-4 py-3 text-sm text-danger">
          {t("rooms.list.error")}
        </div>
        <Button variant="ghost" data-testid="room-list-retry" onClick={() => void rooms.refetch()}>
          {t("error.retry")}
        </Button>
      </div>
    );
  }
  if (rooms.data.length === 0) {
    return (
      <p data-testid="room-list-empty" className="px-4 py-3 text-sm text-ink-3">
        {t("rooms.list.emptyMember")}
      </p>
    );
  }

  return (
    <nav data-testid="room-list" aria-label={t("rooms.list.title")}>
      <div className="px-2 pb-2">
        <input
          data-testid="room-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("rooms.search.label")}
          placeholder={t("rooms.search.placeholder")}
          className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-ink text-md-touch md:text-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      </div>
      {filtered.length === 0 && (
        <p data-testid="room-list-no-match" className="px-4 py-2 text-sm text-ink-3">
          {t("rooms.search.noMatch")}
        </p>
      )}
      <ul>
        {openRooms.map((room) => (
          <li key={room.id}>
            <RoomListItem room={room} active={room.id === activeId} unread={unread[room.id]} meId={me.id} />
          </li>
        ))}
      </ul>
      {archivedRooms.length > 0 && (
        <>
          <button
            type="button"
            data-testid="room-list-archived-toggle"
            aria-expanded={archivedOpen}
            className="mx-2 mt-3 flex h-8 items-center gap-1 px-3 text-xs font-medium text-ink-3"
            onClick={() => setArchivedOpen((open) => !open)}
          >
            {archivedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t("rooms.list.archived", { n: archivedRooms.length })}
          </button>
          {archivedOpen && (
            <ul>
              {archivedRooms.map((room) => (
                <li key={room.id}>
                  <RoomListItem room={room} active={room.id === activeId} unread={unread[room.id]} meId={me.id} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </nav>
  );
}
