import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import { displayName } from "../../ui/displayName";

function reasonKey(errorClass: string): CopyKey {
  if (errorClass === "rate_limited" || errorClass === "overloaded") return "reply.reason.busy";
  if (errorClass === "timeout" || errorClass === "network") return "reply.reason.unreachable";
  if (errorClass === "auth") return "reply.reason.auth";
  if (errorClass === "not_found") return "reply.reason.notFound";
  if (errorClass === "content_filter") return "reply.reason.refused";
  return "reply.reason.other";
}

export function ReplyFailed(props: { member: RoomMember; errorClass: string | null; blocked?: boolean }): ReactElement {
  const t = useT();
  const name = displayName(props.member);
  const text = props.blocked
    ? t("reply.blocked", { name })
    : props.errorClass === null
      ? t("reply.failed", { name })
      : t("reply.failedWithReason", { name, reason: t(reasonKey(props.errorClass)) });
  return (
    <div data-testid="reply-failed" data-member={props.member.id} role="status" className="flex items-center gap-2 px-4 py-1 text-sm text-danger">
      <AlertTriangle size={16} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
