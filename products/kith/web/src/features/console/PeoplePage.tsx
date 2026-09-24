import { useState, type ReactElement } from "react";
import { useMe } from "../../api/auth";
import { useAdminMembers, useUpdateMember } from "../../api/members";
import type { AdminMember } from "../../api/types";
import { useT } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { CreatePersonDialog } from "./CreatePersonDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

export function PeoplePage(): ReactElement {
  const t = useT();
  const me = useMe().data;
  const people = useAdminMembers("human");
  const update = useUpdateMember();
  const [open, setOpen] = useState(false);
  const [resetMember, setResetMember] = useState<AdminMember | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t("console.people.title")}</h1>
        <Button variant="primary" data-testid="people-add" onClick={() => setOpen(true)}>
          {t("console.people.add")}
        </Button>
      </div>
      {people.isPending && <div data-testid="people-loading" aria-busy="true" className="h-24 rounded-md bg-surface-2" />}
      {people.isError && (
        <div data-testid="people-error" role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t("rooms.list.error")}
          <Button variant="ghost" onClick={() => void people.refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      )}
      {people.data && (
        <ul data-testid="people-list" className="flex flex-col gap-2">
          {people.data.map((member) => (
            <li key={member.id} data-testid="people-row" data-id={member.id} data-handle={member.handle} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <Avatar size={40} id={member.id} name={member.display_name || member.handle} kind="human" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-md text-ink">{member.display_name}</p>
                <p className="truncate text-sm text-ink-3">@{member.handle}</p>
              </div>
              <div className="flex items-center gap-2">
                {member.is_operator === 1 && <Badge tone="accent">{t("console.people.operator")}</Badge>}
                {member.must_change_password && (
                  <Badge tone="warn" data-testid="people-badge-must-change">
                    {t("console.people.mustChange")}
                  </Badge>
                )}
                {member.disabled_at && (
                  <Badge tone="danger" data-testid="people-badge-disabled">
                    {t("console.people.disabled")}
                  </Badge>
                )}
              </div>
              {me && member.id !== me.id && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" data-testid="people-reset" onClick={() => setResetMember(member)}>
                    {t("console.people.reset")}
                  </Button>
                  <Button
                    variant="ghost"
                    data-testid="people-toggle-disabled"
                    onClick={() => update.mutate({ memberId: member.id, disabled: member.disabled_at === null })}
                  >
                    {member.disabled_at ? t("console.people.enable") : t("console.people.disable")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <CreatePersonDialog open={open} onOpenChange={setOpen} />
      <ResetPasswordDialog member={resetMember} onOpenChange={(next) => { if (!next) setResetMember(null); }} />
    </div>
  );
}
