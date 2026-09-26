import { MoreHorizontal } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import type { ServerMessage } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Menu } from "../../ui/Menu";

export function MessageActions(props: { row: ServerMessage; isOperator: boolean; roomSlug: string }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const { row } = props;
  const [coarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  const fields: [string, string][] = [
    ["seq", String(row.seq)],
    ["id", row.id],
    ["client_message_id", row.client_message_id],
    ["generation_id", row.generation_id ?? "—"],
    ["created_at", row.created_at],
  ];
  return (
    <div className={"absolute right-3 top-1 " + (coarse ? "flex" : "hidden group-hover:flex")}>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            data-testid="message-actions"
            aria-label={copied ? t("message.copied") : t("message.actions")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2"
          >
            <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end">
            <Menu.Item
              data-testid="message-action-copy"
              onSelect={() => {
                void navigator.clipboard.writeText(row.body).then(
                  () => setCopied(true),
                  () => {},
                );
              }}
            >
              <span aria-live="polite">{copied ? t("message.copied") : t("message.copy")}</span>
            </Menu.Item>
            {props.row.thread_id === null && (
              <Menu.Item
                data-testid="message-action-thread"
                onSelect={() => navigate("/r/" + props.roomSlug + "/t/" + props.row.id)}
              >
                {t("message.replyInThread")}
              </Menu.Item>
            )}
            {props.isOperator && (
              <Menu.Item data-testid="message-action-details" onSelect={() => setDetails(true)}>
                {t("message.details")}
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Dialog open={details} onOpenChange={setDetails} title={t("message.detailsTitle")} data-testid="message-details">
        <dl className="grid grid-cols-1 gap-2 text-sm">
          {fields.map(([field, value]) => (
            <div key={field}>
              <dt className="text-ink-3">{field}</dt>
              <dd>
                <code data-testid={"message-details-" + field}>{value}</code>
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setDetails(false)}>
            {t("members.close")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
