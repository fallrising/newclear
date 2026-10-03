import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT } from "../../copy";
import { useNow, useStatusStore } from "../../store/statuses";
import { displayName } from "../../ui/displayName";

export function TypingIndicator(props: { roomId: string; members: RoomMember[] | undefined; meId: string }): ReactElement | null {
  const t = useT();
  const now = useNow(1000);
  const typing = useStatusStore((s) => s.rooms[props.roomId]?.typing);
  const names = Object.entries(typing ?? {})
    .filter(([id, expires]) => id !== props.meId && expires > now)
    .map(([id]) => props.members?.find((member) => member.id === id))
    .filter((member): member is RoomMember => member !== undefined)
    .map((member) => displayName(member));
  if (names.length === 0) return null;
  const text =
    names.length === 1
      ? t("typing.one", { a: names[0]! })
      : names.length === 2
        ? t("typing.two", { a: names[0]!, b: names[1]! })
        : t("typing.many", { n: names.length });
  return (
    <p data-testid="typing-indicator" role="status" className="px-4 pb-1 text-sm text-ink-3">
      {text}
    </p>
  );
}
