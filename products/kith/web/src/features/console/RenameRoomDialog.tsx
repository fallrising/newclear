import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useUpdateRoom } from "../../api/rooms";
import type { RoomSummary } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";

export function RenameRoomDialog(props: { room: RoomSummary | null; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const update = useUpdateRoom();
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setName(props.room?.name ?? "");
    setInvalid(false);
    setFailed(false);
  }, [props.room]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!props.room) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    update.mutate(
      { roomId: props.room.id, name: trimmed },
      {
        onSuccess: () => props.onOpenChange(false),
        onError: () => setFailed(true),
      },
    );
  };

  return (
    <Dialog open={props.room !== null} onOpenChange={props.onOpenChange} title={t("console.rooms.renameTitle")}>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <TextField
          id="rename-input"
          data-testid="rename-input"
          label={t("rooms.create.name")}
          type="text"
          autoComplete="off"
          value={name}
          onChange={setName}
          invalid={invalid}
        />
        {invalid && <p className="text-sm text-danger">{t("rooms.create.nameInvalid")}</p>}
        {failed && (
          <p data-testid="rename-error" role="alert" className="text-sm text-danger">
            {t("error.code.unknown")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            {t("console.rooms.cancel")}
          </Button>
          <Button variant="primary" type="submit" data-testid="rename-submit" disabled={update.isPending}>
            {t("console.rooms.renameSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
