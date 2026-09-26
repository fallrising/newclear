import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import type { ReplyPhase } from "../../store/statuses";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { displayName } from "../../ui/displayName";

const PHASE_KEY: Record<ReplyPhase, CopyKey> = {
  replying: "reply.replying",
  accepted: "reply.accepted",
  running: "reply.running",
};

export function ReplyPlaceholder(props: { member: RoomMember; draft?: string; phase?: ReplyPhase }): ReactElement {
  const t = useT();
  const name = displayName(props.member);
  const label = t(PHASE_KEY[props.phase ?? "replying"], { name });
  return (
    <div
      data-testid="reply-placeholder"
      data-member={props.member.id}
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex gap-3 px-4 pt-3 pb-0.5"
    >
      <Avatar size={36} id={props.member.id} name={name} kind="agent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-md font-medium text-ink">{name}</span>
          <Badge tone="neutral">AI</Badge>
        </div>
        <p className="text-sm text-ink-2">{label}</p>
        {props.draft ? (
          <p data-testid="reply-draft" aria-hidden="true" className="whitespace-pre-wrap break-words text-md text-ink">
            {props.draft}
            <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-ink-2 animate-caret" />
          </p>
        ) : (
          <span className="inline-flex gap-1 pt-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-dot" />
            <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-dot dot-2" />
            <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-dot dot-3" />
          </span>
        )}
      </div>
    </div>
  );
}
