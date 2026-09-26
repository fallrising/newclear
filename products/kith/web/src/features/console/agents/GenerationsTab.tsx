import type { ReactElement } from "react";
import { useAgentGenerations } from "../../../api/agents";
import type { Generation, LlmErrorClass } from "../../../api/types";
import { errorCopyKey } from "../../../api/errors";
import { useLocale, useT } from "../../../copy";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { formatListTime, localTimeZone } from "../../../ui/time";
import { errorClassKey } from "./runtimeText";

function stateTone(state: Generation["state"]): "accent" | "danger" | "neutral" | "warn" {
  if (state === "completed") return "accent";
  if (state === "failed") return "danger";
  if (state === "dropped") return "neutral";
  return "warn";
}

export function GenerationsTab(props: { agentId: string }): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const generations = useAgentGenerations(props.agentId);
  const rows = generations.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" data-testid="generations-refresh" onClick={() => void generations.refetch()}>
        {t("console.generations.refresh")}
      </Button>
      {generations.isPending && <div data-testid="generations-loading" aria-busy="true" className="h-16 rounded-md bg-surface-2" />}
      {generations.isError && (
        <div data-testid="generations-error" role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t(errorCopyKey(generations.error))}
          <Button variant="ghost" onClick={() => void generations.refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      )}
      {generations.isSuccess && rows.length === 0 && <p data-testid="generations-empty">{t("console.generations.empty")}</p>}
      {generations.isSuccess && rows.length > 0 && (
        <ol data-testid="generations-list" className="flex flex-col divide-y divide-border">
          {rows.map((row) => {
            const duration = row.duration_ms === null ? "—" : t("console.generations.duration", { s: (row.duration_ms / 1000).toFixed(1) });
            const tokens =
              row.input_tokens === null && row.output_tokens === null
                ? "—"
                : t("console.generations.tokens", { in: row.input_tokens ?? "—", out: row.output_tokens ?? "—" });
            return (
              <li key={row.id} data-testid="generation-row" data-state={row.state} data-error-class={row.error_class ?? ""} className="flex flex-col gap-1 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={stateTone(row.state)} data-testid="generation-state">
                    {t(`console.generations.state.${row.state}`)}
                  </Badge>
                  <time dateTime={row.created_at}>{formatListTime(row.created_at, locale, new Date(), localTimeZone())}</time>
                  <span>{t("console.generations.room", { room: row.room_name ?? "—" })}</span>
                </div>
                <p className="text-sm text-ink-2">
                  <span data-testid="generation-duration">{duration}</span>
                  {" · "}
                  <span data-testid="generation-tokens">{tokens}</span>
                  {row.model ? " · " + row.model : ""}
                </p>
                {row.error_class !== null && (
                  <p data-testid="generation-error" className="text-sm text-danger">
                    {t(errorClassKey(row.error_class as LlmErrorClass))}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
