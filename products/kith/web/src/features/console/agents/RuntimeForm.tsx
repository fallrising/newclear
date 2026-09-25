import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { useProviders, useTestProvider } from "../../../api/providers";
import type { AdapterKind, AgentDetail, PutRuntimeBody, QuotaClass, RuntimeKind } from "../../../api/types";
import { useT, type CopyKey } from "../../../copy";
import { Button } from "../../../ui/Button";
import { SelectField } from "../../../ui/SelectField";
import { TextArea } from "../../../ui/TextArea";
import { TextField } from "../../../ui/TextField";

type RuntimeFormProps = {
  mode: "create" | "edit";
  current: AgentDetail | null;
  onSubmit: (body: PutRuntimeBody) => void;
  submitting: boolean;
  submitLabel: string;
};

const ADAPTERS: AdapterKind[] = ["codex", "claude_code", "gemini_cli", "command"];
const KINDS: RuntimeKind[] = ["hosted", "runner", "external"];

function formatLabel(t: (key: CopyKey) => string, format: string): string {
  if (format === "openai_chat" || format === "anthropic_messages") return t(`console.providers.format.${format}`);
  return format;
}

export function RuntimeForm(props: RuntimeFormProps): ReactElement {
  const t = useT();
  const providers = useProviders();
  const testProvider = useTestProvider();
  const current = props.current;
  const initialKind: RuntimeKind = props.mode === "create" ? "hosted" : (current?.runtime ?? "hosted");
  const [kind, setKind] = useState<RuntimeKind>(initialKind);
  const [connectionId, setConnectionId] = useState(props.mode === "edit" ? (current?.connection_id ?? "") : "");
  const [model, setModel] = useState(props.mode === "edit" && current?.runtime === "hosted" ? (current.model ?? "") : "");
  const [adapter, setAdapter] = useState<AdapterKind | "">(
    props.mode === "edit" && current?.adapter_kind ? current.adapter_kind : "",
  );
  const [quota, setQuota] = useState<QuotaClass | "">(props.mode === "edit" ? (current?.quota_class ?? "") : "");
  const [maxTokens, setMaxTokens] = useState(String(props.mode === "edit" ? (current?.max_output_tokens ?? 1024) : 1024));
  const [temperature, setTemperature] = useState(
    props.mode === "edit" && current?.temperature != null ? String(current.temperature) : "",
  );
  const [addendum, setAddendum] = useState(props.mode === "edit" ? (current?.system_prompt_addendum ?? "") : "");
  const [listed, setListed] = useState<{ ok: true; models: string[] | null } | { ok: false } | null>(null);
  const [modelError, setModelError] = useState(false);
  const [maxError, setMaxError] = useState(false);
  const [tempError, setTempError] = useState(false);

  const enabled = (providers.data?.providers ?? []).filter((provider) => provider.disabled_at === null);

  useEffect(() => {
    if (kind !== "hosted" || connectionId === "") {
      setListed(null);
      return;
    }
    let live = true;
    testProvider.mutate(
      { id: connectionId },
      {
        onSuccess: (result) => {
          if (!live) return;
          setListed(result.ok ? { ok: true, models: result.models } : { ok: false });
        },
        onError: () => {
          if (live) setListed({ ok: false });
        },
      },
    );
    return () => {
      live = false;
    };
  }, [kind, connectionId]);

  function onKind(next: RuntimeKind): void {
    setKind(next);
    if (props.mode === "edit") {
      const same = current != null && next === (current.runtime ?? "hosted");
      setQuota(same ? current.quota_class : "");
      return;
    }
    if (next !== "hosted") {
      setQuota("");
      return;
    }
    const provider = enabled.find((item) => item.id === connectionId);
    setQuota(provider?.default_quota_class ?? "");
  }

  function onConnection(id: string): void {
    setConnectionId(id);
    const keep = props.mode === "edit" && current?.connection_id === id ? (current.model ?? "") : "";
    setModel(keep);
    setModelError(false);
    if (props.mode === "create" && kind === "hosted") {
      const provider = enabled.find((item) => item.id === id);
      setQuota(provider?.default_quota_class ?? "");
    }
  }

  const modelIds = listed?.ok && listed.models ? [...listed.models] : [];
  if (model !== "" && !modelIds.includes(model)) modelIds.unshift(model);
  const modelMenu = listed?.ok === true && listed.models !== null && listed.models.length > 0;
  const maxValue = Number(maxTokens);
  const tempValue = temperature.trim() === "" ? null : Number(temperature);

  function submit(): void {
    const badModel = kind === "hosted" && model.trim() === "";
    const badMax = !Number.isInteger(maxValue) || maxValue < 1 || maxValue > 8192;
    const badTemp = tempValue !== null && !(tempValue >= 0 && tempValue <= 2);
    setModelError(badModel);
    setMaxError(kind === "hosted" && badMax);
    setTempError(kind === "hosted" && badTemp);
    if (quota === "" || badModel || (kind === "hosted" && (badMax || badTemp)) || (kind === "runner" && adapter === "")) return;
    if (kind === "hosted") {
      props.onSubmit({
        runtime: "hosted",
        quota_class: quota,
        connection_id: connectionId,
        model: model.trim(),
        system_prompt_addendum: addendum,
        max_output_tokens: maxValue,
        ...(tempValue === null ? {} : { temperature: tempValue }),
      });
      return;
    }
    if (kind === "runner") {
      props.onSubmit({ runtime: "runner", quota_class: quota, adapter_kind: adapter as AdapterKind });
      return;
    }
    props.onSubmit({ runtime: "external", quota_class: quota });
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        {KINDS.map((item) => (
          <label key={item} className="flex flex-col gap-1 text-sm text-ink">
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="runtime-kind"
                data-testid={"runtime-kind-" + item}
                checked={kind === item}
                onChange={() => onKind(item)}
              />
              {t(`console.agents.kind.${item}`)}
            </span>
            <span className="pl-6 text-ink-3">{t(`console.agents.kindHelp.${item}`)}</span>
          </label>
        ))}
      </fieldset>

      {kind === "hosted" && (
        enabled.length === 0 ? (
          <p data-testid="runtime-no-provider" className="text-sm text-ink-2">
            {t("console.agents.noProvider")}{" "}
            <Link data-testid="runtime-add-provider" to="/console/providers/new" className="text-accent">
              {t("console.agents.addProvider")}
            </Link>
          </p>
        ) : (
          <SelectField
            id="runtime-connection"
            data-testid="runtime-connection"
            label={t("console.agents.connection")}
            value={connectionId}
            placeholder={t("console.agents.connection")}
            options={enabled.map((provider) => ({
              value: provider.id,
              label: provider.name + "（" + formatLabel(t, provider.api_format) + "）",
            }))}
            onChange={onConnection}
          />
        )
      )}

      {kind === "hosted" && connectionId !== "" && listed !== null && (
        modelMenu ? (
          <SelectField
            id="runtime-model"
            data-testid="runtime-model"
            label={t("console.agents.model")}
            value={model}
            placeholder={t("console.agents.model")}
            options={modelIds.map((id) => ({ value: id, label: id }))}
            invalid={modelError}
            onChange={(value) => {
              setModel(value);
              setModelError(false);
            }}
          />
        ) : (
          <>
            <TextField
              id="runtime-model-input"
              data-testid="runtime-model-input"
              label={t("console.agents.model")}
              type="text"
              autoComplete="off"
              placeholder={t("console.agents.modelFree")}
              value={model}
              invalid={modelError}
              onChange={(value) => {
                setModel(value);
                setModelError(false);
              }}
            />
            {listed.ok === false && <p data-testid="runtime-model-hint" className="text-sm text-ink-3">{t("console.agents.modelListFailed")}</p>}
          </>
        )
      )}
      {modelError && <p data-testid="runtime-model-error" className="text-sm text-danger">{t("console.agents.modelRequired")}</p>}

      {kind === "hosted" && (
        <details data-testid="runtime-advanced">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">{t("console.providers.advanced")}</summary>
          <div className="mt-3 flex flex-col gap-3">
            <TextField
              id="runtime-max-tokens"
              data-testid="runtime-max-tokens"
              label={t("console.agents.maxTokens")}
              type="text"
              autoComplete="off"
              inputMode="numeric"
              value={maxTokens}
              invalid={maxError}
              onChange={setMaxTokens}
            />
            {maxError && <p data-testid="runtime-max-tokens-error" className="text-sm text-danger">{t("console.agents.maxTokensInvalid")}</p>}
            <TextField
              id="runtime-temperature"
              data-testid="runtime-temperature"
              label={t("console.agents.temperature")}
              type="text"
              autoComplete="off"
              inputMode="decimal"
              value={temperature}
              invalid={tempError}
              onChange={setTemperature}
            />
            <p className="text-xs text-ink-3">{t("console.agents.temperatureHelp")}</p>
            {tempError && <p data-testid="runtime-temperature-error" className="text-sm text-danger">{t("console.agents.temperatureInvalid")}</p>}
            <TextArea
              id="runtime-addendum"
              data-testid="runtime-addendum"
              label={t("console.agents.addendum")}
              rows={4}
              maxBytes={4096}
              value={addendum}
              onChange={setAddendum}
            />
          </div>
        </details>
      )}

      {kind === "runner" && (
        <>
          <SelectField
            id="runtime-adapter"
            data-testid="runtime-adapter"
            label={t("console.agents.adapterLabel")}
            value={adapter}
            placeholder={t("console.agents.adapterLabel")}
            options={ADAPTERS.map((item) => ({ value: item, label: t(`console.agents.adapter.${item}`) }))}
            onChange={(value) => setAdapter(value as AdapterKind)}
          />
          <p className="text-sm text-ink-3">{t("console.agents.runnerLater")}</p>
        </>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink-2">{t("console.agents.quotaQuestion")}</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="runtime-quota"
            data-testid="runtime-quota-api_key"
            checked={quota === "api_key"}
            onChange={() => setQuota("api_key")}
          />
          {t("console.agents.quota.api_key")}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="runtime-quota"
            data-testid="runtime-quota-operator_personal"
            checked={quota === "operator_personal"}
            onChange={() => setQuota("operator_personal")}
          />
          {t("console.agents.quota.operator_personal")}
        </label>
      </fieldset>

      <Button
        variant="primary"
        data-testid="runtime-submit"
        disabled={props.submitting || quota === "" || (kind === "hosted" && (connectionId === "" || model === "")) || (kind === "runner" && adapter === "")}
        onClick={submit}
      >
        {props.submitLabel}
      </Button>
    </div>
  );
}
