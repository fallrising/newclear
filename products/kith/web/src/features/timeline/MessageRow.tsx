import { Clock } from "lucide-react";
import type { ReactElement } from "react";
import { errorCopyKey } from "../../api/errors";
import type { RoomMember } from "../../api/types";
import { Markdown } from "../../markdown/Markdown";
import { useLocale, useT } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { displayName } from "../../ui/displayName";
import { formatClock } from "../../ui/time";
import type { TimelineItem } from "./buildItems";

type Props = {
  item: Extract<TimelineItem, { kind: "message" | "pending" }>;
  sender: RoomMember | undefined;
  senderId: string;
  isMe: boolean;
  onRetry(cmid: string): void;
  onDiscard(cmid: string): void;
};

export function MessageRow(props: Props): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const { item, sender, isMe } = props;
  const name = sender ? displayName(sender) : t("timeline.unknownSender");
  const body = item.kind === "message" ? item.row.body : item.pending.body;
  const createdAt = item.kind === "message" ? item.row.created_at : null;
  const outer =
    "group relative flex gap-3 px-4 pb-0.5 animate-message-in " + (item.groupHead ? "pt-3" : "pt-0.5") + (isMe ? " bg-accent-tint" : "");
  const pending = item.kind === "pending" ? item.pending : null;
  const faded = pending !== null && pending.state !== "failed";

  const content = (
    <>
      <div className="w-9 shrink-0">
        {item.groupHead ? (
          <Avatar size={36} id={props.senderId} name={name} kind={sender?.kind ?? "human"} />
        ) : createdAt ? (
          <time data-mask="time" dateTime={createdAt} className="invisible group-hover:visible text-xs text-ink-3">
            {formatClock(createdAt, locale)}
          </time>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {item.groupHead && (
          <div className="flex items-baseline gap-2">
            <span data-testid="message-sender" className="text-md font-medium text-ink">
              {isMe ? t("timeline.you") : name}
            </span>
            {createdAt && (
              <time data-mask="time" dateTime={createdAt} className="text-xs text-ink-3">
                {formatClock(createdAt, locale)}
              </time>
            )}
          </div>
        )}
        <div data-testid="message-body" className={"text-md text-ink" + (faded ? " opacity-70" : "")}>
          <Markdown source={body} />
        </div>
        {pending && (
          <div className="text-xs flex items-center gap-2">
            {(pending.state === "queued" || pending.state === "sending") && (
              <span data-testid="pending-status" className="text-ink-3 inline-flex items-center gap-1">
                <Clock size={12} aria-hidden /> {t("timeline.pending.sending")}
              </span>
            )}
            {pending.state === "unknown" && (
              <span data-testid="pending-status" className="text-ink-3">
                {t("timeline.pending.unknown")}
              </span>
            )}
            {pending.state === "failed" && (
              <>
                <span data-testid="pending-status" role="alert" className="text-danger">
                  {t("timeline.pending.failed", { reason: t(errorCopyKey(pending.failCode ?? "unknown")) })}
                </span>
                <Button variant="ghost" data-testid="pending-retry" onClick={() => props.onRetry(pending.clientMessageId)}>
                  {t("timeline.pending.retry")}
                </Button>
                <Button variant="ghost" data-testid="pending-discard" onClick={() => props.onDiscard(pending.clientMessageId)}>
                  {t("timeline.pending.discard")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );

  if (item.kind === "message") {
    return (
      <article data-testid="message-row" data-seq={item.row.seq} data-sender={item.row.sender_id} data-cmid={item.row.client_message_id} className={outer}>
        {content}
      </article>
    );
  }
  return (
    <article data-testid="pending-row" data-cmid={item.pending.clientMessageId} data-state={item.pending.state} className={outer}>
      {content}
    </article>
  );
}
