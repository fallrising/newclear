import { useState, type ReactElement } from "react";
import type { AgentDetail, PutRuntimeBody, RuntimeKind } from "../../../api/types";
import { useT } from "../../../copy";
import { Button } from "../../../ui/Button";
import { Dialog } from "../../../ui/Dialog";

function kindName(kind: RuntimeKind | null): string {
  if (kind === "hosted") return "Hosted";
  if (kind === "runner") return "Runner";
  if (kind === "external") return "External";
  return "v1";
}

export function RuntimeChangeDialog(props: {
  open: boolean;
  from: AgentDetail;
  body: PutRuntimeBody;
  onConfirm: (body: PutRuntimeBody) => void;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const fromKind = props.from.runtime;
  const toKind = props.body.runtime;
  const defaultRevoke = (fromKind === "runner" || fromKind === "external") && toKind === "hosted";
  const [revoke, setRevoke] = useState(defaultRevoke);
  const showRevoke = props.from.token_count > 0;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={t("console.agents.changeTitle")} data-testid="runtime-change-dialog">
      <ul data-testid="runtime-change-effects" className="list-disc pl-5 text-sm text-ink-2">
        <li>{t("console.agents.effectInflight")}</li>
        {fromKind !== toKind && <li>{t("console.agents.effectKind", { from: kindName(fromKind), to: kindName(toKind) })}</li>}
        {props.from.quota_class !== props.body.quota_class && (
          <li>{t("console.agents.effectQuota", { from: props.from.quota_class, to: props.body.quota_class })}</li>
        )}
        {(toKind === "runner" || toKind === "external") && <li>{t("console.agents.effectNoDispatch")}</li>}
      </ul>
      {showRevoke && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            data-testid="runtime-revoke-tokens"
            checked={revoke}
            onChange={(event) => setRevoke(event.target.checked)}
          />
          {t("console.agents.revokeTokens", { n: props.from.token_count })}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" data-testid="runtime-change-cancel" onClick={() => props.onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          data-testid="runtime-change-confirm"
          onClick={() => props.onConfirm({ ...props.body, revoke_tokens: showRevoke && revoke })}
        >
          {t("console.agents.apply")}
        </Button>
      </div>
    </Dialog>
  );
}
