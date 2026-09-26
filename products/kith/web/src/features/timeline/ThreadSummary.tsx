import { MessageSquareReply } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import { useLocale, useT } from "../../copy";
import { formatListTime, localTimeZone } from "../../ui/time";

export function ThreadSummary(props: { roomSlug: string; rootId: string; count: number; lastAt: string }): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="thread-summary"
      data-root={props.rootId}
      className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent-strong hover:bg-surface-2"
      onClick={() => navigate("/r/" + props.roomSlug + "/t/" + props.rootId)}
    >
      <MessageSquareReply size={16} strokeWidth={1.75} aria-hidden />
      {t("thread.replies", { n: props.count })}
      <span>· {formatListTime(props.lastAt, locale, new Date(), localTimeZone())}</span>
    </button>
  );
}
