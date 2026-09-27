import { useState, type ReactElement } from "react";
import { useAgentTokens, useIssueToken, useRevokeToken } from "../../../api/agents";
import type { BotToken } from "../../../api/types";
import { useT } from "../../../copy";
import { Button } from "../../../ui/Button";
import { CopyBlock } from "../../../ui/CopyBlock";
import { Dialog } from "../../../ui/Dialog";

function tokenState(token: BotToken, now: number): "revoked" | "expired" | "active" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && Date.parse(token.expires_at) <= now) return "expired";
  return "active";
}

export function TokensTab(props: { agentId: string }): ReactElement {
  const t = useT();
  const tokens = useAgentTokens(props.agentId);
  const issue = useIssueToken();
  const revoke = useRevokeToken();
  const [issued, setIssued] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const now = Date.now();
  const rows = tokens.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="primary"
        data-testid="tokens-issue"
        disabled={issue.isPending}
        onClick={() => {
          issue.mutate(
            { agentId: props.agentId },
            { onSuccess: (result) => setIssued(result.token) },
          );
        }}
      >
        {t("console.tokens.issue")}
      </Button>
      {issued && (
        <>
          <CopyBlock data-testid="token-issued" label={t("console.agents.tokenLabel")} value={issued} />
          <p className="text-sm text-warn">{t("console.agents.tokenOnce")}</p>
        </>
      )}
      {tokens.data && rows.length === 0 && <p data-testid="tokens-empty">{t("console.tokens.empty")}</p>}
      {rows.length > 0 && (
        <ul data-testid="tokens-list" className="flex flex-col gap-2">
          {rows.map((token) => {
            const state = tokenState(token, now);
            return (
              <li
                key={token.id}
                data-testid="token-row"
                data-id={token.id}
                data-state={state}
                className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{token.created_at}</span>
                <span>{token.last_used_at ? t("console.tokens.lastUsed", { time: token.last_used_at }) : t("console.tokens.neverUsed")}</span>
                {token.revoked_at && <span>{t("console.tokens.revokedAt", { time: token.revoked_at })}</span>}
                {state === "expired" && <span>{t("console.tokens.expired")}</span>}
                {state === "active" && (
                  <Button variant="ghost" data-testid="token-revoke" onClick={() => setRevokeId(token.id)}>
                    {t("console.tokens.revoke")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={revokeId !== null}
        onOpenChange={(open) => { if (!open) setRevokeId(null); }}
        title={t("console.tokens.revokeTitle")}
        description={t("console.tokens.revokeHelp")}
        data-testid="token-revoke-dialog"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" data-testid="token-revoke-cancel" onClick={() => setRevokeId(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            data-testid="token-revoke-confirm"
            disabled={revoke.isPending || revokeId === null}
            onClick={() => {
              if (!revokeId) return;
              revoke.mutate(
                { agentId: props.agentId, tokenId: revokeId },
                { onSuccess: () => setRevokeId(null) },
              );
            }}
          >
            {t("console.tokens.revoke")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
