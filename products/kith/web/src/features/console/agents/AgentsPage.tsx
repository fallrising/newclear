import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import { useAgents } from "../../../api/agents";
import { useT } from "../../../copy";
import { Avatar } from "../../../ui/Avatar";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { runtimeLabel, statusKey, statusTone } from "./runtimeText";

export function AgentsPage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const agents = useAgents();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t("console.agents.title")}</h1>
        <Button variant="primary" data-testid="agents-add" onClick={() => void navigate("/console/agents/new")}>
          {t("console.agents.add")}
        </Button>
      </div>
      {agents.isPending && <div data-testid="agents-loading" aria-busy="true" className="h-24 rounded-md bg-surface-2" />}
      {agents.isError && (
        <div data-testid="agents-error" role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t("error.code.unknown")}
          <Button variant="ghost" onClick={() => void agents.refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      )}
      {agents.data && agents.data.length === 0 && <p data-testid="agents-empty">{t("console.agents.empty")}</p>}
      {agents.data && agents.data.length > 0 && (
        <ul data-testid="agents-list" className="flex flex-col gap-2">
          {agents.data.map((agent) => (
            <li
              key={agent.id}
              data-testid="agent-row"
              data-id={agent.id}
              data-handle={agent.handle}
              data-runtime={agent.runtime ?? "v1"}
              data-status={agent.runtime_status}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
            >
              <Avatar size={40} id={agent.id} name={agent.display_name || agent.handle} kind="agent" runtime={agent.runtime} />
              <div className="min-w-0 flex-1">
                <Link data-testid="agent-open" to={"/console/agents/" + agent.id} className="font-medium text-ink">
                  {agent.display_name}
                </Link>
                <p className="truncate text-sm text-ink-3">@{agent.handle}</p>
                <span data-testid="agent-runtime" className="text-sm text-ink-3">{runtimeLabel(t, agent)}</span>
              </div>
              <Badge tone={statusTone(agent.runtime_status)} data-testid="agent-status">
                {t(statusKey(agent.runtime_status))}
              </Badge>
              <span className="text-sm text-ink-3">{t("console.agents.roomsCount", { n: agent.rooms.length })}</span>
              <span className="text-sm text-ink-3">{t("console.agents.tokensCount", { n: agent.token_count })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
