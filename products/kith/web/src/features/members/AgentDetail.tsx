import { ChevronLeft } from "lucide-react";
import type { ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { IconButton } from "../../ui/IconButton";
import { displayName } from "../../ui/displayName";
import { limitView, type LimitView } from "./limit";

function limitCopy(view: LimitView, t: (key: CopyKey, vars?: Record<string, string | number>) => string): string | null {
  if (view.kind === "fixed") return t("members.limit.fixed", { text: view.text });
  if (view.kind === "sidecar_off") return t("members.limit.sidecarOff");
  return null;
}

export function AgentDetail(props: { member: RoomMember; viewerIsOperator: boolean; onBack: () => void }): ReactElement {
  const t = useT();
  const { member } = props;
  const name = displayName(member);
  const limit = limitView(member, props.viewerIsOperator);
  const limitText = limitCopy(limit, t);
  const modeKey = ("members.attentionMode." + member.attention_mode) as CopyKey;
  return (
    <section data-testid="agent-detail" className="flex h-full flex-col">
      <header className="flex h-14 items-center gap-2 border-b border-border px-2">
        <IconButton data-testid="agent-detail-back" label={t("members.back")} icon={ChevronLeft} onClick={props.onBack} />
        <h2 className="text-lg font-semibold text-ink">{t("members.agentTitle")}</h2>
      </header>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar size={40} id={member.id} name={name} kind="agent" />
          <div>
            <p className="text-lg font-semibold">{name}</p>
            <p className="text-sm text-ink-3">@{member.handle}</p>
          </div>
          <Badge tone="neutral">AI</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div>
            <dt className="text-ink-3">{t("members.detail.wake")}</dt>
            <dd data-testid="agent-detail-wake">
              {member.quota_class === "operator_personal" ? t("members.detail.wakeOperator") : t("members.detail.wakeAnyone")}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("members.detail.attention")}</dt>
            <dd data-testid="agent-detail-attention">{t(modeKey)}</dd>
          </div>
          {limitText !== null && (
            <div>
              <dt className="text-ink-3">{t("members.detail.limit")}</dt>
              <dd data-testid="agent-detail-limit">{limitText}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
