import type { ReactElement } from "react";
import { useUpdateRoom } from "../../api/rooms";
import type { RoomSummary } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";

export function ArchiveRoomDialog(props: { room: RoomSummary | null; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const update = useUpdateRoom();
  return (
    <Dialog
      open={props.room !== null}
      onOpenChange={props.onOpenChange}
      title={t("console.rooms.archiveTitle", { room: props.room?.name ?? "" })}
      description={t("console.rooms.archiveHelp")}
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" data-testid="archive-cancel" onClick={() => props.onOpenChange(false)}>
          {t("console.rooms.cancel")}
        </Button>
        <Button
          variant="primary"
          data-testid="archive-confirm"
          disabled={update.isPending || props.room === null}
          onClick={() => {
            if (!props.room) return;
            update.mutate(
              { roomId: props.room.id, archived: true },
              { onSuccess: () => props.onOpenChange(false) },
            );
          }}
        >
          {t("console.rooms.archiveConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}
