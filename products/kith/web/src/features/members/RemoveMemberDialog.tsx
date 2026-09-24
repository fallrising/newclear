import { useState, type ReactElement } from "react";
import { ApiError } from "../../api/client";
import { useRemoveMember } from "../../api/rooms";
import type { RoomMember } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { displayName } from "../../ui/displayName";

export function RemoveMemberDialog(props: {
  roomId: string;
  member: RoomMember | null;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const remove = useRemoveMember();
  const [error, setError] = useState<string | null>(null);
  const member = props.member;
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          props.onOpenChange(false);
        }
      }}
      title={member ? t("members.removeTitle", { name: displayName(member) }) : t("members.remove")}
      description={t("members.removeHelp")}
    >
      {error && (
        <p data-testid="remove-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          data-testid="remove-cancel"
          onClick={() => {
            setError(null);
            props.onOpenChange(false);
          }}
        >
          {t("members.cancel")}
        </Button>
        <Button
          variant="primary"
          data-testid="remove-confirm"
          disabled={remove.isPending || member === null}
          onClick={() => {
            if (!member) return;
            setError(null);
            remove.mutate(
              { roomId: props.roomId, memberId: member.id },
              {
                onSuccess: () => {
                  setError(null);
                  props.onOpenChange(false);
                },
                onError: (err) => {
                  if (err instanceof ApiError && err.code === "last_owner") setError(t("error.code.last_owner"));
                  else setError(t("error.code.unknown"));
                },
              },
            );
          }}
        >
          {t("members.removeConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}
