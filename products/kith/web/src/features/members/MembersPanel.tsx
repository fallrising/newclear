import { X } from "lucide-react";
import { useState, type ReactElement } from "react";
import { useRoomMembers } from "../../api/rooms";
import type { Me, RoomMember, RoomSummary } from "../../api/types";
import { useLocale, useT } from "../../copy";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { displayName } from "../../ui/displayName";
import { AgentDetail } from "./AgentDetail";
import { AttentionDialog } from "./AttentionDialog";
import { MemberRow } from "./MemberRow";
import { RemoveMemberDialog } from "./RemoveMemberDialog";

export function MembersPanel(props: { room: RoomSummary; me: Me; onClose: () => void; onInvite: () => void }): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const members = useRoomMembers(props.room.id);
  const [view, setView] = useState<{ kind: "list" } | { kind: "agent"; id: string }>({ kind: "list" });
  const [removing, setRemoving] = useState<RoomMember | null>(null);
  const [attention, setAttention] = useState<RoomMember | null>(null);
  const collator = new Intl.Collator(locale);
  const byName = (a: RoomMember, b: RoomMember): number => collator.compare(displayName(a), displayName(b));
  const data = members.data;
  const humans = data?.filter((member) => member.kind === "human").sort(byName) ?? [];
  const agents = data?.filter((member) => member.kind === "agent").sort(byName) ?? [];
  const operator = props.me.is_operator === 1;
  const selected = view.kind === "agent" ? data?.find((member) => member.id === view.id) : undefined;
  const showingAgent = view.kind === "agent" && selected != null;

  return (
    <section data-testid="members-panel" aria-label={t("members.title")} className="flex h-full min-h-0 flex-col">
      {showingAgent && selected && (
        <AgentDetail member={selected} viewerIsOperator={operator} onBack={() => setView({ kind: "list" })} />
      )}
      <div className={showingAgent ? "hidden" : "flex h-full min-h-0 flex-col"}>
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-lg font-semibold text-ink">{t("members.title")}</h2>
        <IconButton data-testid="members-close" label={t("members.close")} icon={X} onClick={props.onClose} />
      </header>
      <div className="flex-1 overflow-y-auto py-2">
        {members.isError && (
          <div data-testid="members-error" role="alert" className="mx-3 mb-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-danger">
            {t("members.loadError")}{" "}
            <Button variant="ghost" data-testid="members-retry" onClick={() => void members.refetch()}>
              {t("error.retry")}
            </Button>
          </div>
        )}
        {members.isPending && !data && <p data-testid="members-loading" className="px-4 py-2 text-sm text-ink-3">{t("members.loading")}</p>}
        {data && (
          <>
            <h3 className="px-4 pt-2 pb-1 text-xs font-medium text-ink-3">{t("members.groupHumans", { n: humans.length })}</h3>
            <ul data-testid="members-group-human">
              {humans.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  viewerIsOperator={operator}
                  isMe={member.id === props.me.id}
                  onOpenAgent={(id) => setView({ kind: "agent", id })}
                  onRemove={setRemoving}
                  onAttention={setAttention}
                />
              ))}
            </ul>
            <h3 className="px-4 pt-4 pb-1 text-xs font-medium text-ink-3">{t("members.groupAgents", { n: agents.length })}</h3>
            <ul data-testid="members-group-agent">
              {agents.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  viewerIsOperator={operator}
                  isMe={member.id === props.me.id}
                  onOpenAgent={(id) => setView({ kind: "agent", id })}
                  onRemove={setRemoving}
                  onAttention={setAttention}
                />
              ))}
            </ul>
          </>
        )}
      </div>
      {operator && (
        <footer className="border-t border-border p-3">
          <Button variant="primary" fullWidth data-testid="members-invite" onClick={props.onInvite}>
            {t("members.invite")}
          </Button>
        </footer>
      )}
      <RemoveMemberDialog roomId={props.room.id} member={removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} />
      <AttentionDialog roomId={props.room.id} member={attention} onOpenChange={(open) => { if (!open) setAttention(null); }} />
      </div>
    </section>
  );
}
