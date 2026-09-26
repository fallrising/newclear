import { useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError } from "../../../api/client";
import { errorCopyKey } from "../../../api/errors";
import { useCreateProvider, useProvider, useProviders, useTestDraft, useTestProvider, useUpdateProvider } from "../../../api/providers";
import type { ApiFormat, LlmErrorClass, Provider, ProviderDraft, ProviderPreset, ProviderTestResult } from "../../../api/types";
import { useT, type CopyKey } from "../../../copy";
import { Button } from "../../../ui/Button";
import { SelectField } from "../../../ui/SelectField";
import { TextArea } from "../../../ui/TextArea";
import { TextField } from "../../../ui/TextField";
import { errorClassKey } from "../agents/runtimeText";
import { DeleteProviderDialog } from "./DeleteProviderDialog";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PRESETS = ["openai", "anthropic", "xai", "deepseek", "openrouter", "mistral", "groq", "custom"] as const;
const PRESET_DEFAULTS: Record<ProviderPreset, { api_format: ApiFormat | null; base_url: string | null; token_param: "max_tokens" | "max_completion_tokens" }> = {
  openai: { api_format: "openai_chat", base_url: "https://api.openai.com/v1", token_param: "max_completion_tokens" },
  anthropic: { api_format: "anthropic_messages", base_url: "https://api.anthropic.com", token_param: "max_tokens" },
  google: { api_format: "gemini", base_url: "https://generativelanguage.googleapis.com/v1beta", token_param: "max_tokens" },
  xai: { api_format: "openai_chat", base_url: "https://api.x.ai/v1", token_param: "max_tokens" },
  deepseek: { api_format: "openai_chat", base_url: "https://api.deepseek.com", token_param: "max_tokens" },
  openrouter: { api_format: "openai_chat", base_url: "https://openrouter.ai/api/v1", token_param: "max_tokens" },
  mistral: { api_format: "openai_chat", base_url: "https://api.mistral.ai/v1", token_param: "max_tokens" },
  groq: { api_format: "openai_chat", base_url: "https://api.groq.com/openai/v1", token_param: "max_tokens" },
  custom: { api_format: null, base_url: null, token_param: "max_tokens" },
};

type Source = "stored" | "env" | "none";
type FormState = {
  preset: ProviderPreset | "";
  apiFormat: ApiFormat;
  name: string;
  baseUrl: string;
  source: Source;
  secret: string;
  secretEnv: string;
  quota: "" | "api_key" | "operator_personal";
  tokenParam: "max_tokens" | "max_completion_tokens";
  headers: string;
};

const EMPTY: FormState = {
  preset: "",
  apiFormat: "openai_chat",
  name: "",
  baseUrl: "",
  source: "stored",
  secret: "",
  secretEnv: "",
  quota: "",
  tokenParam: "max_tokens",
  headers: "",
};

function headersText(headers: Record<string, string>): string {
  return Object.entries(headers).map(([name, value]) => name + ": " + value).join("\n");
}

function parseHeaders(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) return null;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (name === "") return null;
    out[name] = value;
  }
  return out;
}

function secretInvalid(secret: string): boolean {
  return secret !== "" && (secret !== secret.trim() || /[\n\r]/.test(secret));
}

function fromProvider(provider: Provider): FormState {
  const preset = (PRESETS as readonly string[]).includes(provider.preset) ? provider.preset : "custom";
  const format: ApiFormat = provider.api_format === "anthropic_messages" ? "anthropic_messages" : "openai_chat";
  return {
    preset,
    apiFormat: format,
    name: provider.name,
    baseUrl: provider.base_url,
    source: provider.secret_source,
    secret: "",
    secretEnv: provider.secret_env ?? "",
    quota: provider.default_quota_class,
    tokenParam: provider.token_param,
    headers: headersText(provider.extra_headers),
  };
}

export function ProviderForm(props: { mode: "new" | "edit" }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? "";
  const list = useProviders();
  const existing = useProvider(props.mode === "edit" ? id : "");
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const testDraft = useTestDraft();
  const testSaved = useTestProvider();
  const [form, setForm] = useState<FormState | null>(props.mode === "new" ? EMPTY : null);
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canStore = list.data?.can_store_secrets !== false;

  if (props.mode === "edit" && existing.data && form === null) {
    const next = fromProvider(existing.data);
    setForm(next);
    setBaseline(next);
  }
  if (props.mode === "new" && form && form.source === "stored" && list.data && !list.data.can_store_secrets) {
    setForm({ ...form, source: "env" });
  }

  if (props.mode === "edit" && existing.isPending) {
    return <div data-testid="provider-loading" aria-busy="true" className="h-24 rounded-md bg-surface-2" />;
  }
  if (props.mode === "edit" && existing.isError) {
    return <p data-testid="provider-error" role="alert">{t(errorCopyKey(existing.error))}</p>;
  }
  if (!form) return <></>;

  const parsedHeaders = parseHeaders(form.headers);
  const headersBad = parsedHeaders === null;
  const nameBad = form.name !== "" && !NAME_RE.test(form.name);
  const secretBad = form.source === "stored" && secretInvalid(form.secret);
  const dirty = baseline !== null && JSON.stringify(form) !== JSON.stringify(baseline);
  const testing = testDraft.isPending || testSaved.isPending;

  function draftBody(): ProviderDraft {
    const body: ProviderDraft = {
      preset: form!.preset === "" ? "custom" : form!.preset,
      api_format: form!.apiFormat,
      base_url: form!.baseUrl,
      secret_source: form!.source,
      extra_headers: parsedHeaders ?? {},
      token_param: form!.tokenParam,
    };
    if (form!.source === "stored") body.secret = form!.secret;
    if (form!.source === "env") body.secret_env = form!.secretEnv;
    return body;
  }

  function patchBody(): Record<string, unknown> {
    if (!baseline) return {};
    const patch: Record<string, unknown> = {};
    if (form!.name !== baseline.name) patch.name = form!.name;
    if (form!.baseUrl !== baseline.baseUrl) patch.base_url = form!.baseUrl;
    if (form!.source !== baseline.source) patch.secret_source = form!.source;
    if (form!.source === "stored" && form!.secret !== "") patch.secret = form!.secret;
    if (form!.source === "env" && form!.secretEnv !== baseline.secretEnv) patch.secret_env = form!.secretEnv;
    if (form!.quota !== "" && form!.quota !== baseline.quota) patch.default_quota_class = form!.quota;
    if (form!.tokenParam !== baseline.tokenParam) patch.token_param = form!.tokenParam;
    if (form!.headers !== baseline.headers && parsedHeaders) patch.extra_headers = parsedHeaders;
    return patch;
  }

  const saveDisabled =
    form.preset === "" ||
    form.quota === "" ||
    !NAME_RE.test(form.name) ||
    form.baseUrl.trim() === "" ||
    secretBad ||
    headersBad ||
    (form.source === "stored" && props.mode === "new" && form.secret === "") ||
    (form.source === "env" && !ENV_RE.test(form.secretEnv)) ||
    (props.mode === "edit" && Object.keys(patchBody()).length === 0) ||
    create.isPending ||
    update.isPending;

  async function onTest(): Promise<void> {
    setError(null);
    setSaved(false);
    const next = props.mode === "edit" ? await testSaved.mutateAsync({ id }) : await testDraft.mutateAsync(draftBody());
    setResult(next);
  }

  async function onSave(): Promise<void> {
    setError(null);
    setSaved(false);
    try {
      if (props.mode === "new") {
        await create.mutateAsync({ ...draftBody(), name: form!.name, default_quota_class: form!.quota as "api_key" | "operator_personal" });
        void navigate("/console/providers");
        return;
      }
      await update.mutateAsync({ id, patch: patchBody() });
      setBaseline(form);
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  const formatOptions = [
    { value: "openai_chat", label: t("console.providers.format.openai_chat") },
    { value: "anthropic_messages", label: t("console.providers.format.anthropic_messages") },
  ];

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <h1 className="text-xl font-semibold text-ink">{props.mode === "new" ? t("console.providers.add") : form.name}</h1>
      {props.mode === "new" ? (
        <SelectField
          id="provider-preset"
          data-testid="provider-preset"
          label={t("console.providers.presetLabel")}
          value={form.preset}
          placeholder={t("console.providers.presetLabel")}
          options={PRESETS.map((preset) => ({ value: preset, label: t(`console.providers.preset.${preset}` as CopyKey) }))}
          onChange={(value) => {
            const preset = value as ProviderPreset;
            const defaults = PRESET_DEFAULTS[preset];
            setForm({
              ...form,
              preset,
              apiFormat: defaults.api_format ?? form.apiFormat,
              baseUrl: defaults.base_url ?? "",
              tokenParam: defaults.token_param,
              name: preset === "custom" ? "" : t(`console.providers.preset.${preset}` as CopyKey),
            });
            setResult(null);
          }}
        />
      ) : (
        <p data-testid="provider-preset" className="text-sm text-ink-2">
          {t(`console.providers.preset.${form.preset === "" ? "custom" : form.preset}` as CopyKey)}
        </p>
      )}
      {form.preset === "custom" && props.mode === "new" ? (
        <SelectField
          id="provider-format"
          data-testid="provider-format"
          label={t("console.providers.formatLabel")}
          value={form.apiFormat}
          options={formatOptions}
          onChange={(value) => setForm({ ...form, apiFormat: value as ApiFormat })}
        />
      ) : form.preset !== "" ? (
        <p data-testid="provider-format" className="text-sm text-ink-2">
          {form.apiFormat === "anthropic_messages" ? t("console.providers.format.anthropic_messages") : t("console.providers.format.openai_chat")}
        </p>
      ) : null}
      <TextField
        id="provider-name"
        data-testid="provider-name"
        label={t("console.providers.nameLabel")}
        type="text"
        autoComplete="off"
        value={form.name}
        invalid={nameBad}
        describedBy={nameBad ? "provider-name-error" : undefined}
        onChange={(name) => setForm({ ...form, name })}
      />
      {nameBad && <p id="provider-name-error" data-testid="provider-name-error" className="text-sm text-danger">{t("console.providers.nameInvalid")}</p>}
      <TextField
        id="provider-base-url"
        data-testid="provider-base-url"
        label={t("console.providers.baseUrlLabel")}
        type="text"
        autoComplete="off"
        value={form.baseUrl}
        onChange={(baseUrl) => setForm({ ...form, baseUrl })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink-2">{t("console.providers.secretSource")}</legend>
        {(["stored", "env", "none"] as const).map((source) => (
          <label key={source} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="provider-secret-source"
              data-testid={"provider-secret-source-" + source}
              checked={form.source === source}
              disabled={source === "stored" && !canStore}
              onChange={() => setForm({ ...form, source })}
            />
            {t(source === "stored" ? "console.providers.secretStored" : source === "env" ? "console.providers.secretEnv" : "console.providers.secretNone")}
          </label>
        ))}
      </fieldset>
      {form.source === "stored" && (
        <>
          <TextField
            id="provider-secret"
            data-testid="provider-secret"
            label={t("console.providers.secretLabel")}
            type="password"
            autoComplete="off"
            value={form.secret}
            placeholder={props.mode === "edit" ? t("console.providers.secretKeep", { last4: existing.data?.secret_last4 ?? "" }) : undefined}
            invalid={secretBad}
            describedBy={secretBad ? "provider-secret-error" : undefined}
            onChange={(secret) => setForm({ ...form, secret })}
          />
          {secretBad && <p id="provider-secret-error" data-testid="provider-secret-error" className="text-sm text-danger">{t("console.providers.secretInvalid")}</p>}
        </>
      )}
      {form.source === "env" && (
        <TextField
          id="provider-secret-env"
          data-testid="provider-secret-env"
          label={t("console.providers.secretEnvLabel")}
          type="text"
          autoComplete="off"
          value={form.secretEnv}
          onChange={(secretEnv) => setForm({ ...form, secretEnv })}
        />
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink-2">{t("console.providers.personalQuestion")}</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="provider-quota" data-testid="provider-quota-api_key" checked={form.quota === "api_key"} onChange={() => setForm({ ...form, quota: "api_key" })} />
          {t("console.providers.personalNo")}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="provider-quota" data-testid="provider-quota-operator_personal" checked={form.quota === "operator_personal"} onChange={() => setForm({ ...form, quota: "operator_personal" })} />
          {t("console.providers.personalYes")}
        </label>
      </fieldset>
      <details data-testid="provider-advanced">
        <summary className="cursor-pointer text-sm font-medium text-ink-2">{t("console.providers.advanced")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          {form.apiFormat === "openai_chat" && (
            <SelectField
              id="provider-token-param"
              data-testid="provider-token-param"
              label={t("console.providers.tokenParam")}
              value={form.tokenParam}
              options={[
                { value: "max_tokens", label: "max_tokens" },
                { value: "max_completion_tokens", label: "max_completion_tokens" },
              ]}
              onChange={(tokenParam) => setForm({ ...form, tokenParam: tokenParam as FormState["tokenParam"] })}
            />
          )}
          <TextArea
            id="provider-headers"
            data-testid="provider-headers"
            label={t("console.providers.headers")}
            rows={3}
            value={form.headers}
            invalid={headersBad}
            describedBy={headersBad ? "provider-headers-error" : undefined}
            onChange={(headers) => setForm({ ...form, headers })}
          />
          {headersBad && <p id="provider-headers-error" data-testid="provider-headers-error" className="text-sm text-danger">{t("console.providers.headersInvalid")}</p>}
        </div>
      </details>
      {result && (
        <div data-testid="provider-test-result" role="status" data-ok={String(result.ok)} className="text-sm text-ink">
          {result.ok && result.models
            ? t("console.providers.testOk", { n: result.models.length })
            : result.ok
              ? t("console.providers.testOkNoList")
              : t("console.providers.testFailed", { reason: t(errorClassKey(result.error_class as LlmErrorClass)) })}
          {result.ok && result.models && (
            <ul data-testid="provider-test-models">
              {result.models.slice(0, 20).map((model) => <li key={model}>{model}</li>)}
            </ul>
          )}
        </div>
      )}
      {props.mode === "edit" && dirty && <p data-testid="provider-test-dirty" className="text-sm text-ink-3">{t("console.providers.testSaveFirst")}</p>}
      {saved && <p data-testid="provider-saved" role="status">{t("common.saved")}</p>}
      {error != null && (
        <p data-testid="provider-error" role="alert" className="text-sm text-danger">
          {t(errorCopyKey(error))}
          {error instanceof ApiError && error.code === "invalid_request" && <span className="mt-1 block text-xs text-ink-3">{error.message}</span>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          data-testid="provider-test"
          disabled={testing || (props.mode === "edit" && dirty) || secretBad || form.baseUrl.trim() === ""}
          onClick={() => void onTest()}
        >
          {testing ? t("console.providers.testing") : t("console.providers.test")}
        </Button>
        <Button variant="primary" type="submit" data-testid="provider-save" disabled={saveDisabled}>
          {t("console.providers.save")}
        </Button>
        <Button variant="ghost" data-testid="provider-cancel" onClick={() => void navigate("/console/providers")}>
          {t("common.cancel")}
        </Button>
        {props.mode === "edit" && existing.data && (
          <>
            <Button
              variant="ghost"
              data-testid="provider-toggle-disabled"
              onClick={() => {
                void update.mutateAsync({ id, patch: { disabled: existing.data.disabled_at === null } }).then(() => void existing.refetch());
              }}
            >
              {existing.data.disabled_at ? t("console.providers.enable") : t("console.providers.disable")}
            </Button>
            <Button variant="ghost" data-testid="provider-delete" onClick={() => setDeleteOpen(true)}>
              <span className="text-danger">{t("console.providers.delete")}</span>
            </Button>
          </>
        )}
      </div>
      {props.mode === "edit" && existing.data && (
        <DeleteProviderDialog
          id={id}
          name={existing.data.name}
          agentCount={existing.data.agent_count}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </form>
  );
}
