import { useState, type ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useAgent, usePutRuntime, useUpdateAgent } from "../../../api/agents";
import { ApiError } from "../../../api/client";
import { errorCopyKey } from "../../../api/errors";
import { useAllRooms, useInviteMember } from "../../../api/rooms";
import type { PutRuntimeBody, RoomMember } from "../../../api/types";
import { useT } from "../../../copy";
import { Avatar } from "../../../ui/Avatar";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { SelectField } from "../../../ui/SelectField";
import { RemoveMemberDialog } from "../../members/RemoveMemberDialog";
import { GenerationsTab } from "./GenerationsTab";
import { RuntimeChangeDialog } from "./RuntimeChangeDialog";
import { RuntimeForm } from "./RuntimeForm";
import { runtimeLabel, statusKey, statusTone } from "./runtimeText";
import { TokensTab } from "./TokensTab";

const TABS = ["overview", "runtime", "tokens", "rooms", "generations"] as const;
type Tab = (typeof TABS)[number];

export function AgentDetailPage(): ReactElement {
  const t = useT();
  const params = useParams();
  const id = params.id ?? "";
  const agent = useAgent(id);
  const update = useUpdateAgent();
  const put = usePutRuntime();
  const rooms = useAllRooms();
  const invite = useInviteMember();
  const [search, setSearch] = useSearchParams();
  const tab = (TABS.includes(search.get("tab") as Tab) ? search.get("tab") : "overview") as Tab;
  const [pendingBody, setPendingBody] = useState<PutRuntimeBody | null>(null);
  const [savedEpoch, setSavedEpoch] = useState<number | null>(null);
  const [roomId, setRoomId] = useState("");
  const [removeRoom, setRemoveRoom] = useState<string | null>(null);
  const detail = agent.data;

  function selectTab(next: Tab): void {
    const copy = new URLSearchParams(search);
    copy.set("tab", next);
    setSearch(copy);
  }

  if (agent.isPending) return <div data-testid="agent-loading" aria-busy="true" className="h-24 rounded-md bg-surface-2" />;
  if (agent.isError) {
    const missing = agent.error instanceof ApiError && agent.error.code === "not_found";
    return (
      <div className="flex flex-col gap-3">
        <p data-testid="agent-not-found" role="alert">{missing ? t("console.agents.notFound") : t(errorCopyKey(agent.error))}</p>
        <Link to="/console/agents" className="text-accent">{t("console.agents.title")}</Link>
      </div>
    );
  }
  if (!detail) return <></>;

  const joined = new Set(detail.rooms ?? []);
  const available = (rooms.data ?? []).filter((room) => room.archived_at === null && !joined.has(room.id));
  const removing = removeRoom
    ? ({
        id: detail.id,
        kind: "agent",
        handle: detail.handle,
        display_name: detail.display_name,
        quota_class: detail.quota_class,
        is_operator: 0,
        role: "member",
        attention_mode: "mention",
        keywords_json: "[]",
        policy_epoch: 1,
        operator_only: false,
        reply_limit: null,
      } satisfies RoomMember)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar size={40} id={detail.id} name={detail.display_name || detail.handle} kind="agent" runtime={detail.runtime} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{detail.display_name}</h1>
          <p className="text-sm text-ink-3">@{detail.handle}</p>
        </div>
        <Badge tone={statusTone(detail.runtime_status)} data-testid="agent-status">{t(statusKey(detail.runtime_status))}</Badge>
        <Button
          variant="ghost"
          data-testid="agent-toggle-disabled"
          onClick={() => void update.mutateAsync({ id: detail.id, disabled: detail.disabled_at === null }).then(() => agent.refetch())}
        >
          {detail.disabled_at ? t("console.agents.enable") : t("console.agents.disable")}
        </Button>
      </div>
      <div role="tablist" className="flex gap-2 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            data-testid={"agent-tab-" + item}
            aria-selected={tab === item}
            className={"h-10 px-3 text-sm " + (tab === item ? "border-b-2 border-accent font-medium text-ink" : "text-ink-3")}
            onClick={() => selectTab(item)}
          >
            {t(`console.agents.tab.${item}`)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div data-testid="agent-overview" className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt className="text-ink-3">{t("members.detail.runtime")}</dt>
              <dd>{runtimeLabel(t, detail)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">{t("console.agents.quotaQuestion")}</dt>
              <dd data-testid="agent-quota">{t(`console.agents.quota.${detail.quota_class}`)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">{t("console.agents.epoch", { n: detail.runtime_epoch })}</dt>
              <dd data-testid="agent-epoch">{t("console.agents.epoch", { n: detail.runtime_epoch })}</dd>
            </div>
          </dl>
          <ol data-testid="agent-changes" className="flex flex-col gap-1 text-sm text-ink-2">
            {detail.runtime_changes.map((change) => (
              <li key={change.id} data-testid="agent-change">
                {t("console.agents.changeLine", {
                  time: change.created_at,
                  name: change.changed_by_name,
                  from: change.from_runtime ?? t("console.agents.runtime.v1"),
                  to: change.to_runtime,
                })}
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "runtime" && (
        <div data-testid="agent-runtime-tab" className="flex flex-col gap-3">
          {search.get("pending") === "1" && <p data-testid="agent-runtime-pending">{t("console.agents.runtimePending")}</p>}
          {savedEpoch !== null && <p data-testid="runtime-saved" role="status">{t("console.agents.runtimeSaved", { n: savedEpoch })}</p>}
          <RuntimeForm
            mode="edit"
            current={detail}
            submitting={put.isPending}
            submitLabel={t("common.save")}
            onSubmit={(body) => setPendingBody(body)}
          />
          {pendingBody && (
            <RuntimeChangeDialog
              open
              from={detail}
              body={pendingBody}
              onOpenChange={(open) => {
                if (!open) setPendingBody(null);
              }}
              onConfirm={(body) => {
                void put.mutateAsync({ id: detail.id, body }).then((result) => {
                  setSavedEpoch(result.runtime_epoch);
                  setPendingBody(null);
                  void agent.refetch();
                });
              }}
            />
          )}
        </div>
      )}

      {tab === "tokens" && <TokensTab agentId={detail.id} />}

      {tab === "generations" && <GenerationsTab agentId={detail.id} />}

      {tab === "rooms" && (
        <div data-testid="agent-rooms" className="flex flex-col gap-3">
          {(detail.rooms ?? []).length === 0 && <p data-testid="agent-rooms-list">{t("console.agents.noRooms")}</p>}
          {(detail.rooms ?? []).length > 0 && (
            <ul data-testid="agent-rooms-list" className="flex flex-col gap-2">
              {detail.rooms.map((joinedId) => {
                const room = rooms.data?.find((item) => item.id === joinedId);
                return (
                  <li key={joinedId} data-testid="agent-room-row" className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <span>{room?.name ?? joinedId}</span>
                    <Button variant="ghost" data-testid="agent-room-remove" onClick={() => setRemoveRoom(joinedId)}>
                      {t("console.agents.roomRemove")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SelectField
                id="agent-room-add-select"
                data-testid="agent-room-add-select"
                label={t("console.agents.roomAdd")}
                value={roomId}
                placeholder={t("console.agents.roomAdd")}
                options={available.map((room) => ({ value: room.id, label: room.name }))}
                onChange={setRoomId}
              />
            </div>
            <Button
              variant="primary"
              data-testid="agent-room-add"
              disabled={roomId === "" || invite.isPending}
              onClick={() => {
                const room = available.find((item) => item.id === roomId);
                if (!room) return;
                invite.mutate(
                  { roomId: room.id, handle: detail.handle },
                  {
                    onSuccess: () => {
                      setRoomId("");
                      void agent.refetch();
                    },
                  },
                );
              }}
            >
              {t("console.agents.roomAdd")}
            </Button>
          </div>
          <RemoveMemberDialog roomId={removeRoom ?? ""} member={removing} onOpenChange={(open) => { if (!open) { setRemoveRoom(null); void agent.refetch(); } }} />
        </div>
      )}
    </div>
  );
}
