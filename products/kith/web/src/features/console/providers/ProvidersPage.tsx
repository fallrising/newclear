import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import { useProviders } from "../../../api/providers";
import type { Provider } from "../../../api/types";
import { useT } from "../../../copy";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { errorClassKey, formatLabel } from "../agents/runtimeText";

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function statusOf(provider: Provider): "disabled" | "error" | "untested" | "ok" {
  if (provider.disabled_at) return "disabled";
  if (provider.last_error_class) return "error";
  if (provider.last_checked_at === null) return "untested";
  return "ok";
}

export function ProvidersPage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const providers = useProviders();
  const data = providers.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t("console.providers.title")}</h1>
        <Button variant="primary" data-testid="providers-add" onClick={() => void navigate("/console/providers/new")}>
          {t("console.providers.add")}
        </Button>
      </div>
      {data && !data.can_store_secrets && (
        <p data-testid="providers-no-secrets-key" role="note" className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {t("console.providers.noSecretsKey")}
        </p>
      )}
      {providers.isPending && <div data-testid="providers-loading" aria-busy="true" className="h-24 rounded-md bg-surface-2" />}
      {providers.isError && (
        <div data-testid="providers-error" role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t("error.code.unknown")}
          <Button variant="ghost" onClick={() => void providers.refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      )}
      {data && data.providers.length === 0 && <p data-testid="providers-empty">{t("console.providers.empty")}</p>}
      {data && data.providers.length > 0 && (
        <ul data-testid="providers-list" className="flex flex-col gap-2">
          {data.providers.map((provider) => {
            const status = statusOf(provider);
            const format = formatLabel(t, provider.api_format);
            const key =
              provider.secret_source === "stored"
                ? t("console.providers.keyLast4", { last4: provider.secret_last4 ?? "" })
                : provider.secret_source === "env"
                  ? t("console.providers.keyEnv", { name: provider.secret_env ?? "" })
                  : t("console.providers.keyNone");
            return (
              <li
                key={provider.id}
                data-testid="provider-row"
                data-id={provider.id}
                data-name={provider.name}
                className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Link data-testid="provider-open" to={"/console/providers/" + provider.id} className="font-medium text-ink">
                    {provider.name}
                  </Link>
                  {provider.default_quota_class === "operator_personal" && (
                    <Badge tone="warn" data-testid="provider-personal">
                      {t("console.providers.personal")}
                    </Badge>
                  )}
                  <span data-testid="provider-status" data-status={status} className="ml-auto">
                    <Badge
                      tone={status === "ok" ? "accent" : status === "error" ? "danger" : "neutral"}
                    >
                      {status === "error"
                        ? t("console.providers.status.error", {
                            reason: t(provider.last_error_class ? errorClassKey(provider.last_error_class) : "console.errorClass.unknown"),
                          })
                        : t(`console.providers.status.${status}`)}
                    </Badge>
                  </span>
                </div>
                <p className="text-sm text-ink-3">
                  {format}
                  {" · "}
                  {hostOf(provider.base_url)}
                  {" · "}
                  {key}
                  {" · "}
                  {t("console.providers.agentCount", { n: provider.agent_count })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
