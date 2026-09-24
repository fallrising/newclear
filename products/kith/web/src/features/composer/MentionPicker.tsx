import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { displayName } from "../../ui/displayName";
import { limitView, showsOperatorOnly, type LimitView } from "../members/limit";

function limitCopy(view: LimitView, t: (key: CopyKey, vars?: Record<string, string | number>) => string): string | null {
  if (view.kind === "fixed") return t("members.limit.fixed", { text: view.text });
  if (view.kind === "sidecar_off") return t("members.limit.sidecarOff");
  return null;
}

export function MentionPicker(props: {
  id: string;
  options: RoomMember[];
  activeIndex: number;
  viewerIsOperator: boolean;
  onPick: (member: RoomMember) => void;
}): ReactElement {
  const t = useT();
  return (
    <ul
      id={props.id}
      data-testid="mention-listbox"
      role="listbox"
      aria-label={t("mention.label")}
      className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-popover"
    >
      {props.options.map((member, index) => {
        const active = index === props.activeIndex;
        const name = displayName(member);
        const limit = limitCopy(limitView(member, props.viewerIsOperator), t);
        return (
          <li
            key={member.id}
            id={props.id + "-" + index}
            role="option"
            aria-selected={active}
            data-testid="mention-option"
            data-handle={member.handle}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(member);
            }}
            className={
              "flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 " +
              (active ? "bg-accent-tint outline-2 outline-accent" : "")
            }
          >
            <Avatar size={24} id={member.id} name={name} kind={member.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-md text-ink">{name}</span>
              <span className="block truncate text-sm text-ink-3">@{member.handle}</span>
              {limit !== null && (
                <span data-testid="mention-option-limit" className="block text-sm text-ink-2">
                  {limit}
                </span>
              )}
            </span>
            {member.kind === "agent" && <Badge tone="neutral">AI</Badge>}
            {showsOperatorOnly(member, props.viewerIsOperator) && (
              <Badge tone="warn" data-testid="mention-option-operator-only">
                {t("members.operatorOnly")}
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
