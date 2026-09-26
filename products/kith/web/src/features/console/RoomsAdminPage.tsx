import { useState, type ReactElement, type ReactNode } from "react";
import { useAllRooms, useUpdateRoom } from "../../api/rooms";
import type { RoomSummary } from "../../api/types";
import { useT } from "../../copy";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { ArchiveRoomDialog } from "./ArchiveRoomDialog";
import { RenameRoomDialog } from "./RenameRoomDialog";

export function RoomsAdminPage(props: {
  renderInvite: (props: { room: RoomSummary | null; onOpenChange: (open: boolean) => void }) => ReactNode;
}): ReactElement {
  const t = useT();
  const rooms = useAllRooms();
  const update = useUpdateRoom();
  const [rename, setRename] = useState<RoomSummary | null>(null);
  const [archive, setArchive] = useState<RoomSummary | null>(null);
  const [invite, setInvite] = useState<RoomSummary | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{t("console.rooms.title")}</h1>
      {rooms.isPending && <div aria-busy="true" className="h-24 rounded-md bg-surface-2" />}
      {rooms.data && (
        <ul data-testid="console-rooms-list" className="flex flex-col gap-2">
          {rooms.data.map((room) => (
            <li key={room.id} data-testid="console-room-row" data-id={room.id} data-slug={room.slug} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-md text-ink">{room.name}</p>
                <p className="truncate text-sm text-ink-3">#{room.slug}</p>
                <p className="text-sm text-ink-2">{t("console.rooms.members", { n: room.member_count })}</p>
              </div>
              {room.archived_at && (
                <Badge tone="neutral" data-testid="console-room-archived-badge">
                  {t("console.rooms.archived")}
                </Badge>
              )}
              <Button variant="ghost" data-testid="console-room-rename" onClick={() => setRename(room)}>
                {t("console.rooms.rename")}
              </Button>
              <Button variant="ghost" data-testid="console-room-invite" onClick={() => setInvite(room)}>
                {t("console.rooms.invite")}
              </Button>
              {room.archived_at ? (
                <Button
                  variant="ghost"
                  data-testid="console-room-unarchive"
                  onClick={() => update.mutate({ roomId: room.id, archived: false })}
                >
                  {t("console.rooms.unarchive")}
                </Button>
              ) : (
                <Button variant="ghost" data-testid="console-room-archive" onClick={() => setArchive(room)}>
                  {t("console.rooms.archive")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RenameRoomDialog room={rename} onOpenChange={(open) => { if (!open) setRename(null); }} />
      <ArchiveRoomDialog room={archive} onOpenChange={(open) => { if (!open) setArchive(null); }} />
      {props.renderInvite({ room: invite, onOpenChange: (open) => { if (!open) setInvite(null); } })}
    </div>
  );
}
