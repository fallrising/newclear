import type { ReactElement } from "react";
import { Link, useParams } from "react-router";
import { useRooms } from "../../api/rooms";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";

export function RoomList(): ReactElement {
  const t = useT();
  const rooms = useRooms();
  const { slug } = useParams();

  if (rooms.isPending) {
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
        {t("rooms.list.empty")}
      </p>
    );
  }
  return (
    <nav data-testid="room-list" aria-label={t("rooms.list.title")}>
      <ul>
        {rooms.data.map((room) => {
          const active = room.slug === slug;
          const cls =
            "flex h-10 items-center gap-2 rounded-md mx-2 px-3 text-md text-ink hover:bg-surface" +
            (active ? " bg-accent-tint font-medium text-accent-strong border-l-2 border-accent" : "");
          return (
            <li key={room.id}>
              <Link
                data-testid="room-list-item"
                data-id={room.id}
                data-slug={room.slug}
                to={"/r/" + room.slug}
                aria-current={active ? "page" : undefined}
                className={cls}
              >
                <span className="text-ink-3">#</span>
                <span className="truncate">{room.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
