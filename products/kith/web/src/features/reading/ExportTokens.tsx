import { useEffect, useRef, useState, type ReactElement } from "react";
import { apiFetch } from "../../api/client";
import { useT, type CopyKey } from "../../copy";
import { Button } from "../../ui/Button";

type Token = { id: string; created_at: string; revoked_at: string | null };
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function ExportTokens(): ReactElement {
  const t = useT();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [secret, setSecret] = useState<{ id: string; token: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<CopyKey>("reading.tokensHelp");
  const [refresh, setRefresh] = useState(0);
  const action = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; action.current?.abort(); };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    void apiFetch<{ tokens: Token[] }>("/api/reading-export/tokens", { signal: controller.signal })
      .then((value) => {
        if (!value || !Array.isArray(value.tokens) || !value.tokens.every((token) => token && safeId(token.id) &&
          typeof token.created_at === "string" && (token.revoked_at === null || typeof token.revoked_at === "string"))) throw new Error("invalid tokens");
        if (active) setTokens(value.tokens);
      })
      .catch(() => { if (active) setStatus("reading.tokensLoadFailed"); })
      .finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [refresh]);

  async function change(id?: string): Promise<void> {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setBusy(true);
    setStatus("app.loading");
    try {
      if (id) {
        await apiFetch("/api/reading-export/tokens/" + encodeURIComponent(id), { method: "DELETE", signal: controller.signal });
        if (!mounted.current) return;
        if (secret?.id === id) setSecret(null);
        setStatus("reading.tokenRevoked");
      } else {
        const value = await apiFetch<{ id: string; token: string }>("/api/reading-export/tokens", { method: "POST", body: {}, signal: controller.signal });
        if (!value || !safeId(value.id) || typeof value.token !== "string" || !/^kith_export_[A-Za-z0-9_-]+$/.test(value.token)) throw new Error("invalid token");
        if (!mounted.current) return;
        // This is deliberately component memory only: no browser storage or URL.
        setSecret(value);
        setStatus("reading.tokenCreated");
      }
    } catch {
      if (mounted.current) setStatus("reading.tokenUnknown");
    } finally {
      window.clearTimeout(timeout);
      action.current = null;
      if (mounted.current) { setBusy(false); setRefresh((value) => value + 1); }
    }
  }
  return <details className="rounded-md border border-border p-4">
    <summary className="cursor-pointer font-medium">{t("reading.tokensTitle")}</summary>
    <div className="space-y-3 pt-3">
      <p className="text-sm text-ink-2">{t("reading.tokensHelp")}</p>
      <p role="status" data-testid="export-token-status">{t(status)}</p>
      <Button data-testid="export-token-create" variant="ghost" disabled={busy || loading} onClick={() => void change()}>{t("reading.tokenCreate")}</Button>
      <Button variant="ghost" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>{t("captures.refresh")}</Button>
      {secret && <div className="space-y-2">
        <p>{t("reading.tokenOnce")}</p>
        <code data-testid="export-token-value" className="block select-all break-all rounded-md bg-surface-2 p-3">{secret.token}</code>
        <Button variant="ghost" onClick={() => setSecret(null)}>{t("reading.tokenHide")}</Button>
      </div>}
      <ul data-testid="export-token-list" aria-busy={loading} className="space-y-2">
        {tokens.map((token) => <li key={token.id} className="flex flex-wrap items-center gap-3 text-sm">
          <code className="break-all">{token.id}</code>
          <span>{token.revoked_at === null ? t("reading.tokenActive") : t("reading.tokenRevoked")}</span>
          {token.revoked_at === null && <Button data-testid={"export-token-revoke-" + token.id} variant="ghost" disabled={busy || loading} onClick={() => void change(token.id)}>{t("reading.tokenRevoke")}</Button>}
        </li>)}
      </ul>
    </div>
  </details>;
}
