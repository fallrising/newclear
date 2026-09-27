import { useEffect, useState, type ReactElement } from "react";
import { ApiError } from "../../api/client";
import { errorCopyKey } from "../../api/errors";
import { searchMembers } from "../../api/members";
import { useInviteMember } from "../../api/rooms";
import type { AdminMember, RoomSummary } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";

export function InviteDialog(props: { room: RoomSummary | null; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const invite = useInviteMember();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AdminMember[]>([]);
  const [selected, setSelected] = useState<AdminMember | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<CopyKey | null>(null);

  useEffect(() => {
    if (!props.room) {
      setQuery("");
      setOptions([]);
      setSelected(null);
      setDone(false);
      setError(null);
      return;
    }
    const q = query.trim();
    if (q === "") {
      setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      void searchMembers(q, ctrl.signal)
        .then((members) => setOptions(members))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
        });
    }, 200);
    return () => {
      window.clearTimeout(id);
      ctrl.abort();
    };
  }, [query, props.room]);

  return (
    <Dialog
      open={props.room !== null}
      onOpenChange={props.onOpenChange}
      title={t("console.invite.title", { room: props.room?.name ?? "" })}
    >
      <div className="flex flex-col gap-3">
        <TextField
          id="invite-query"
          data-testid="invite-query"
          label={t("console.invite.query")}
          type="text"
          autoComplete="off"
          value={query}
          onChange={setQuery}
        />
        <ul data-testid="invite-options" role="listbox" className="flex flex-col gap-1">
          {options.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                data-testid="invite-option"
                data-handle={member.handle}
                role="option"
                className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-surface-2"
                onClick={() => {
                  setSelected(member);
                  setDone(false);
                  setError(null);
                }}
              >
                <Avatar size={28} id={member.id} name={member.display_name || member.handle} kind={member.kind} />
                <span>
                  {member.display_name} @{member.handle}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected && props.room && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              data-testid="invite-submit"
              disabled={invite.isPending}
              onClick={() => {
                const room = props.room;
                const member = selected;
                if (!room) return;
                invite.mutate(
                  { roomId: room.id, handle: member.handle },
                  {
                    onSuccess: () => {
                      setDone(true);
                      setSelected(null);
                      setError(null);
                    },
                    onError: (err) => {
                      if (err instanceof ApiError && (err.code === "already_member" || err.code === "room_full" || err.code === "not_found")) {
                        setError(errorCopyKey(err));
                      } else setError("error.code.unknown");
                    },
                  },
                );
              }}
            >
              {t("console.invite.submit", { name: selected.display_name || selected.handle })}
            </Button>
          </div>
        )}
        {done && (
          <p data-testid="invite-done" role="status" className="text-sm text-ink-2">
            {t("console.invite.done")}
          </p>
        )}
        {error && (
          <p data-testid="invite-error" role="alert" className="text-sm text-danger">
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
