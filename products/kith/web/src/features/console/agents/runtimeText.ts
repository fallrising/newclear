import type { CopyKey, CopyVars } from "../../../copy";
import type { AgentRuntimeSummary, ApiFormat, LlmErrorClass, RuntimeStatus } from "../../../api/types";

type T = (key: CopyKey, vars?: CopyVars) => string;

const ADAPTER_KEYS = {
  codex: "console.agents.adapter.codex",
  claude_code: "console.agents.adapter.claude_code",
  gemini_cli: "console.agents.adapter.gemini_cli",
  command: "console.agents.adapter.command",
} as const satisfies Record<NonNullable<AgentRuntimeSummary["adapter_kind"]>, CopyKey>;

const STATUS_KEYS = {
  ok: "console.agents.status.ok",
  unconfigured: "console.agents.status.unconfigured",
  connection_error: "console.agents.status.connection_error",
  runner_offline: "console.agents.status.runner_offline",
  disabled: "console.agents.status.disabled",
} as const satisfies Record<RuntimeStatus, CopyKey>;

const ERROR_KEYS = {
  auth: "console.errorClass.auth",
  not_found: "console.errorClass.not_found",
  bad_request: "console.errorClass.bad_request",
  context_length: "console.errorClass.context_length",
  rate_limited: "console.errorClass.rate_limited",
  overloaded: "console.errorClass.overloaded",
  content_filter: "console.errorClass.content_filter",
  timeout: "console.errorClass.timeout",
  network: "console.errorClass.network",
  protocol: "console.errorClass.protocol",
  unknown: "console.errorClass.unknown",
} as const satisfies Record<LlmErrorClass, CopyKey>;

const FORMAT_KEYS = {
  openai_chat: "console.providers.format.openai_chat",
  anthropic_messages: "console.providers.format.anthropic_messages",
  openai_responses: "console.providers.format.openai_responses",
  gemini: "console.providers.format.gemini",
} as const satisfies Record<ApiFormat, CopyKey>;

export function formatLabel(t: T, format: string): string {
  if (format in FORMAT_KEYS) return t(FORMAT_KEYS[format as ApiFormat]);
  return format;
}

export function runtimeLabel(t: T, summary: AgentRuntimeSummary): string {
  if (summary.runtime === null) return t("console.agents.runtime.v1");
  if (summary.runtime === "hosted") {
    return t("console.agents.runtime.hostedWith", {
      connection: summary.connection_name ?? "—",
      model: summary.model ?? "—",
    });
  }
  if (summary.runtime === "runner") {
    const adapter = summary.adapter_kind ? t(ADAPTER_KEYS[summary.adapter_kind]) : "—";
    return t("console.agents.runtime.runnerWith", { adapter });
  }
  return t("console.agents.runtime.external");
}

export function statusTone(status: RuntimeStatus): "accent" | "warn" | "danger" | "neutral" {
  if (status === "ok") return "accent";
  if (status === "connection_error") return "danger";
  if (status === "disabled") return "neutral";
  return "warn";
}

export function statusKey(status: RuntimeStatus): CopyKey {
  return STATUS_KEYS[status];
}

export function errorClassKey(errorClass: LlmErrorClass): CopyKey {
  return ERROR_KEYS[errorClass];
}
