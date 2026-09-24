import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useRooms } from "../api/rooms";
import type { RoomSummary } from "../api/types";
import { useT } from "../copy";
import { useRoomNav } from "../store/roomNav";
import { Dialog } from "../ui/Dialog";

export function QuickSwitcher(props: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const rooms = useRooms().data ?? [];
  const order = useRoomNav((s) => s.order);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setActive(0);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [props.open]);

  const needle = query.trim().toLowerCase();
  const options = order
    .map((slug) => rooms.find((room) => room.slug === slug))
    .filter((room): room is RoomSummary => room !== undefined && room.name.toLowerCase().includes(needle))
    .slice(0, 8);
  const chosen = options.length === 0 ? 0 : Math.min(active, options.length - 1);

  const go = (slug: string): void => {
    props.onOpenChange(false);
    void navigate("/r/" + slug);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={t("switcher.title")} data-testid="quick-switcher">
      <input
        ref={inputRef}
        data-testid="quick-switcher-input"
        value={query}
        placeholder={t("switcher.placeholder")}
        aria-label={t("switcher.title")}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (options.length > 0) setActive((i) => (Math.min(i, options.length - 1) + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (options.length > 0) setActive((i) => (Math.min(i, options.length - 1) - 1 + options.length) % options.length);
          } else if (e.key === "Enter") {
            const room = options[chosen];
            if (!room) return;
            e.preventDefault();
            go(room.slug);
          }
        }}
        className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-ink"
      />
      {options.length === 0 ? (
        <p className="text-sm text-ink-3">{t("switcher.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {options.map((room, index) => (
            <li key={room.id}>
              <button
                type="button"
                data-testid="quick-switcher-option"
                data-slug={room.slug}
                aria-selected={index === chosen}
                className={"flex h-10 w-full items-center rounded-sm px-2 text-left " + (index === chosen ? "bg-accent-tint" : "")}
                onClick={() => go(room.slug)}
              >
                {room.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
