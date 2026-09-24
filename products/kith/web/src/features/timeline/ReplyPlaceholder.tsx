import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { displayName } from "../../ui/displayName";

export function ReplyPlaceholder(props: { member: RoomMember }): ReactElement {
  const t = useT();
  const name = displayName(props.member);
  return (
    <div
      data-testid="reply-placeholder"
      data-member={props.member.id}
      role="status"
      aria-label={t("reply.replying", { name })}
      className="flex gap-3 px-4 pt-3 pb-0.5"
    >
      <Avatar size={36} id={props.member.id} name={name} kind="agent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-md font-medium text-ink">{name}</span>
          <Badge tone="neutral">AI</Badge>
        </div>
        <span className="inline-flex gap-1 pt-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-dot" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-dot dot-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-dot dot-3" />
        </span>
      </div>
    </div>
  );
}
