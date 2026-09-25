import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useCreateAgent, useIssueToken, usePutRuntime } from "../../../api/agents";
import { ApiError } from "../../../api/client";
import type { PutRuntimeBody } from "../../../api/types";
import { useT } from "../../../copy";
import { Button } from "../../../ui/Button";
import { CopyBlock } from "../../../ui/CopyBlock";
import { TextField } from "../../../ui/TextField";
import { RuntimeForm } from "./RuntimeForm";

const HANDLE_RE = /^[a-z0-9_]{2,32}$/;

function snippet(body: PutRuntimeBody, handle: string, token: string): string {
  const origin = window.location.origin;
  if (body.runtime === "external") {
    return JSON.stringify({ url: origin + "/mcp", headers: { Authorization: "Bearer " + token } }, null, 2);
  }
  const adapter = body.runtime === "runner" ? body.adapter_kind : "";
  return [
    'kith_url = "' + origin + '"',
    'bot_token_file = "/var/lib/kith-runner/' + handle + '/token"',
    'quota_class = "' + body.quota_class + '"',
    "[adapter]",
    'kind = "' + adapter + '"',
  ].join("\n");
}

export function CreateAgentWizard(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateAgent();
  const put = usePutRuntime();
  const issue = useIssueToken();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; token: string | null; body: PutRuntimeBody } | null>(null);
  const steps = [
    { id: "basic", label: t("console.agents.stepBasic") },
    { id: "runtime", label: t("console.agents.stepRuntime") },
    { id: "done", label: t("console.agents.stepDone") },
  ];
  const nameOk = [...displayName.trim()].length >= 1 && [...displayName.trim()].length <= 64;

  async function onRuntime(body: PutRuntimeBody): Promise<void> {
    try {
      const created = await create.mutateAsync({
        handle: handle.trim(),
        display_name: displayName.trim(),
        quota_class: body.quota_class,
      });
      try {
        await put.mutateAsync({ id: created.id, body });
      } catch {
        void navigate("/console/agents/" + created.id + "?tab=runtime&pending=1");
        return;
      }
      let token: string | null = null;
      if (body.runtime !== "hosted") {
        token = (await issue.mutateAsync({ agentId: created.id })).token;
      }
      setDone({ id: created.id, token, body });
      setStep(3);
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_taken") {
        setHandleError(t("error.code.handle_taken"));
        setStep(1);
      }
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <ol data-testid="wizard-steps" className="flex gap-4 text-sm">
        {steps.map((item, index) => (
          <li key={item.id} data-step={item.id} aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "font-medium text-ink" : "text-ink-3"}>
            {item.label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <TextField
            id="agent-create-handle"
            data-testid="agent-create-handle"
            label={t("console.agents.handle")}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            invalid={handleError !== null}
            describedBy={handleError ? "agent-create-handle-error" : undefined}
            onChange={(value) => {
              setHandle(value);
              setHandleError(null);
            }}
          />
          {handleError && <p id="agent-create-handle-error" data-testid="agent-create-handle-error" className="text-sm text-danger">{handleError}</p>}
          <TextField
            id="agent-create-display-name"
            data-testid="agent-create-display-name"
            label={t("console.agents.displayName")}
            type="text"
            autoComplete="off"
            value={displayName}
            onChange={setDisplayName}
          />
          <Button
            variant="primary"
            data-testid="wizard-next"
            disabled={!HANDLE_RE.test(handle.trim()) || !nameOk}
            onClick={() => {
              if (!HANDLE_RE.test(handle.trim())) {
                setHandleError(t("console.people.handleInvalid"));
                return;
              }
              setStep(2);
            }}
          >
            {t("console.agents.next")}
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <RuntimeForm mode="create" current={null} submitting={create.isPending || put.isPending || issue.isPending} submitLabel={t("console.agents.create")} onSubmit={(body) => void onRuntime(body)} />
          <Button variant="ghost" data-testid="wizard-back" onClick={() => setStep(1)}>
            {t("console.agents.back")}
          </Button>
        </div>
      )}

      {step === 3 && done && (
        <div className="flex flex-col gap-3">
          {done.body.runtime === "hosted" ? (
            <p data-testid="wizard-done-step">{t("console.agents.doneHosted")}</p>
          ) : (
            <>
              {done.token && (
                <>
                  <CopyBlock data-testid="wizard-token" label={t("console.agents.tokenLabel")} value={done.token} />
                  <CopyBlock
                    data-testid="wizard-snippet"
                    label={done.body.runtime === "runner" ? t("console.agents.snippetRunner") : t("console.agents.snippetExternal")}
                    value={snippet(done.body, handle.trim(), done.token)}
                    multiline
                  />
                  <p data-testid="wizard-token-once" className="text-sm text-warn">{t("console.agents.tokenOnce")}</p>
                </>
              )}
            </>
          )}
          {done.body.runtime === "hosted" && (
            <Button variant="primary" data-testid="wizard-open-agent" onClick={() => void navigate("/console/agents/" + done.id + "?tab=rooms")}>
              {t("console.agents.openAgent")}
            </Button>
          )}
          <Button variant="ghost" data-testid="wizard-finish" onClick={() => void navigate("/console/agents/" + done.id)}>
            {t("console.agents.finish")}
          </Button>
        </div>
      )}
    </div>
  );
}
