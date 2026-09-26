import { Clock } from "lucide-react";
import type { ReactElement } from "react";
import { errorCopyKey } from "../../api/errors";
import type { RoomMember } from "../../api/types";
import { Markdown } from "../../markdown/Markdown";
import { findMentions } from "../../markdown/mentions";
import { useLocale, useT } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { displayName } from "../../ui/displayName";
import { formatClock } from "../../ui/time";
import type { TimelineItem } from "./buildItems";
import { MessageActions } from "./MessageActions";
import { ThreadSummary } from "./ThreadSummary";

type Props = {
  item: Extract<TimelineItem, { kind: "message" | "pending" }>;
  sender: RoomMember | undefined;
  senderId: string;
  isMe: boolean;
  mentionHandles: readonly string[];
  meHandle: string;
  isOperator: boolean;
  onRetry(cmid: string): void;
  onDiscard(cmid: string): void;
  roomSlug: string;
};

export function MessageRow(props: Props): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const { item, sender, isMe } = props;
  const name = sender ? displayName(sender) : t("timeline.unknownSender");
  const body = item.kind === "message" ? item.row.body : item.pending.body;
  const createdAt = item.kind === "message" ? item.row.created_at : null;
  const mentionsMe = findMentions(body, [props.meHandle]).length > 0;
  const outer =
    "group relative flex gap-3 px-4 pb-0.5 animate-message-in " +
    (item.groupHead ? "pt-3" : "pt-0.5") +
    (mentionsMe ? " border-l-2 border-accent bg-mention-tint" : isMe ? " bg-accent-tint" : "");
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
          <Markdown source={body} mentionHandles={props.mentionHandles} />
        </div>
        {item.kind === "message" && item.replyCount > 0 && item.lastReplyAt && (
          <ThreadSummary roomSlug={props.roomSlug} rootId={item.row.id} count={item.replyCount} lastAt={item.lastReplyAt} />
        )}
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
      <article
        data-testid="message-row"
        data-seq={item.row.seq}
        data-sender={item.row.sender_id}
        data-cmid={item.row.client_message_id}
        data-mentions-me={mentionsMe ? "true" : undefined}
        className={outer}
      >
        {content}
        <MessageActions row={item.row} isOperator={props.isOperator} roomSlug={props.roomSlug} />
      </article>
    );
  }
  return (
    <article data-testid="pending-row" data-cmid={item.pending.clientMessageId} data-state={item.pending.state} className={outer}>
      {content}
    </article>
  );
}
