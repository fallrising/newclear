import { MoreHorizontal } from "lucide-react";
import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { displayName } from "../../ui/displayName";
import { Menu } from "../../ui/Menu";
import { limitView, showsOperatorOnly, type LimitView } from "./limit";

function limitCopy(view: LimitView, t: (key: CopyKey, vars?: Record<string, string | number>) => string): string | null {
  if (view.kind === "fixed") return t("members.limit.fixed", { text: view.text });
  if (view.kind === "sidecar_off") return t("members.limit.sidecarOff");
  return null;
}

export function MemberRow(props: {
  member: RoomMember;
  viewerIsOperator: boolean;
  isMe: boolean;
  onOpenAgent?: (id: string) => void;
  onRemove?: (member: RoomMember) => void;
  onAttention?: (member: RoomMember) => void;
}): ReactElement {
  const t = useT();
  const { member, isMe, viewerIsOperator } = props;
  const agent = member.kind === "agent";
  const name = displayName(member);
  const limit = limitView(member, viewerIsOperator);
  const limitText = limitCopy(limit, t);
  return (
    <li
      data-testid="members-row"
      data-id={member.id}
      data-handle={member.handle}
      data-kind={member.kind}
      className="group flex items-start gap-3 rounded-md px-3 py-2 hover:bg-surface-2"
    >
      <Avatar size={28} id={member.id} name={name} kind={member.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {agent ? (
            <button
              type="button"
              data-testid="members-open-agent"
              className="truncate text-md font-medium text-ink hover:underline"
              onClick={() => props.onOpenAgent?.(member.id)}
            >
              {name}
            </button>
          ) : (
            <span className="truncate text-md font-medium text-ink">
              {name}
              {isMe ? " " + t("members.you") : ""}
            </span>
          )}
          {agent && (
            <Badge tone="neutral" data-testid="members-badge-ai">
              AI
            </Badge>
          )}
          {member.role === "owner" && <Badge tone="neutral">{t("members.owner")}</Badge>}
          {showsOperatorOnly(member, viewerIsOperator) && (
            <Badge tone="warn" data-testid="members-badge-operator-only">
              {t("members.operatorOnly")}
            </Badge>
          )}
        </div>
        <p className="truncate text-sm text-ink-3">@{member.handle}</p>
        {limitText !== null && (
          <p data-testid="members-limit" className="text-sm text-ink-2">
            {limitText}
          </p>
        )}
      </div>
      {viewerIsOperator && !isMe && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              type="button"
              data-testid="members-row-menu"
              aria-label={t("members.menu", { name })}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2"
            >
              <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="end">
              <Menu.Item data-testid="members-action-remove" onSelect={() => props.onRemove?.(member)}>
                {t("members.remove")}
              </Menu.Item>
              {agent && (
                <Menu.Item data-testid="members-action-attention" onSelect={() => props.onAttention?.(member)}>
                  {t("members.attention")}
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
    </li>
  );
}
