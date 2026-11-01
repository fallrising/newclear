import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { useMe } from "../../api/auth";
import { apiFetch, ApiError } from "../../api/client";
import { useT, type CopyKey } from "../../copy";
import { Button } from "../../ui/Button";
import { newCaptureDraft, readCaptureDraft, removeCaptureDraft, storeCaptureDraft, type CaptureDraft } from "./draft";

type Capture = { id: string; body: string; source: "web"; created_at: string; exported_commit: string | null };
type CapturePageResponse = { captures: Capture[]; next_cursor: string | null };
const REQUEST_TIMEOUT_MS = 15_000;

function bodyValid(body: string): boolean {
  return body.length > 0 && new TextEncoder().encode(body).length <= 16384 &&
    !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(body);
}

export function CapturePage(): ReactElement | null {
  const me = useMe().data;
  const t = useT();
  if (!me) return null;
  if (me.is_operator !== 1) return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">{t("captures.forbidden")}</h1>
      <Link to="/" className="text-accent-strong underline">{t("captures.back")}</Link>
    </section>
  );
  // Remount all private state if the authenticated account changes.
  return <OperatorCaptures key={me.id} operatorId={me.id} />;
}

function OperatorCaptures({ operatorId }: { operatorId: string }): ReactElement {
  const t = useT();
  const [initial] = useState(() => readCaptureDraft(operatorId));
  const [draft, setDraft] = useState(initial.draft);
  const [storageFailed, setStorageFailed] = useState(initial.failed);
  const [sending, setSending] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(initial.draft.capture_id ?? null);
  const [requestError, setRequestError] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [inbox, setInbox] = useState<CapturePageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [inboxFailed, setInboxFailed] = useState(false);
  const sendController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sendController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setLoading(true);
    setInboxFailed(false);
    setInbox(null);
    void apiFetch<CapturePageResponse>("/api/captures?limit=20" +
      (cursor === null ? "" : "&cursor=" + encodeURIComponent(cursor)), { signal: controller.signal })
      .then((result) => { if (active) setInbox(result); })
      .catch(() => { if (active) setInboxFailed(true); })
      .finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [cursor, refresh]);

  function changeBody(body: string): void {
    const next: CaptureDraft = { ...draft, body };
    setDraft(next);
    setSavedId(null);
    setRequestError(false);
    setStorageFailed(!storeCaptureDraft(operatorId, next));
  }

  function clearSaved(): void {
    if (!removeCaptureDraft(operatorId)) { setStorageFailed(true); return; }
    setDraft(newCaptureDraft());
    setStorageFailed(false);
  }

  function keepConflictAsNewDraft(): void {
    if (draft.phase !== "conflict") return;
    const next: CaptureDraft = { ...newCaptureDraft(), body: draft.body };
    // Only an explicit conflict-resolution click can create a new identity. Keep the
    // conflict snapshot intact if the replacement cannot be persisted locally.
    if (!storeCaptureDraft(operatorId, next)) { setStorageFailed(true); return; }
    setDraft(next);
    setStorageFailed(false);
    setSavedId(null);
    setRequestError(false);
  }

  async function save(): Promise<void> {
    if (sendController.current || draft.phase === "saved" || draft.phase === "conflict" || !bodyValid(draft.body)) return;
    // Commit the exact retry snapshot locally before any request, including CSRF retrieval.
    // A failed local write must not start a request whose identity could be lost on reload.
    const snapshot: CaptureDraft = { ...draft, phase: "unknown" };
    if (!storeCaptureDraft(operatorId, snapshot)) { setStorageFailed(true); return; }
    setDraft(snapshot);
    setStorageFailed(false);
    setRequestError(false);
    setSavedId(null);
    setSending(true);
    const controller = new AbortController();
    sendController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await apiFetch<{ capture_id: string }>("/api/captures", {
        method: "POST", body: { body: snapshot.body, client_key: snapshot.client_key }, signal: controller.signal,
      });
      if (typeof result?.capture_id !== "string" || result.capture_id.length === 0) throw new Error("invalid response");
      if (!mounted.current) return;
      const confirmed: CaptureDraft = { ...snapshot, phase: "saved", capture_id: result.capture_id };
      // If removal fails, persist a confirmation marker if possible and lock this draft.
      // Even if both operations fail, the remaining snapshot replays the same key safely.
      const removed = removeCaptureDraft(operatorId);
      if (!removed) storeCaptureDraft(operatorId, confirmed);
      setDraft(removed ? newCaptureDraft() : confirmed);
      setStorageFailed(!removed);
      setSavedId(result.capture_id);
      setCursor(null);
      setRefresh((value) => value + 1);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status === 409 && error.code === "capture_conflict") {
        const conflict: CaptureDraft = { ...snapshot, phase: "conflict" };
        setDraft(conflict);
        setStorageFailed(!storeCaptureDraft(operatorId, conflict));
      } else {
        // Network failure, timeout, or a non-success reply is never evidence of no commit.
        setRequestError(true);
      }
    } finally {
      window.clearTimeout(timeout);
      sendController.current = null;
      if (mounted.current) setSending(false);
    }
  }

  let status: CopyKey = "captures.ready";
  if (draft.body) status = "captures.local";
  if (draft.phase === "unknown") status = "captures.unknown";
  if (draft.phase === "conflict") status = "captures.conflict";
  if (storageFailed) status = "captures.storageFailed";
  if (sending) status = "captures.saving";
  if (savedId) status = storageFailed ? "captures.savedCleanup" : "captures.saved";
  const locked = draft.phase !== "draft" || sending;

  return (
    <section className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{t("captures.title")}</h1>
          <Link to="/" className="text-accent-strong underline">{t("captures.back")}</Link>
        </header>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label htmlFor="capture-body" className="block font-medium">{t("captures.body")}</label>
          <textarea id="capture-body" data-testid="capture-body" value={draft.body} readOnly={locked}
            maxLength={16384} rows={7} aria-describedby="capture-limit capture-status"
            className="block w-full resize-y rounded-md border border-border bg-bg p-3 text-ink focus-visible:outline-2 focus-visible:outline-focus"
            onChange={(event) => changeBody(event.target.value)} />
          <p id="capture-limit" className="text-sm text-ink-2">{t("captures.limit")}</p>
          {draft.body && !bodyValid(draft.body) && <p role="alert">{t("captures.invalid")}</p>}
          <p id="capture-status" data-testid="capture-status" role="status" aria-live="polite">
            {t(status)}
          </p>
          {requestError && <p className="text-sm text-ink-2">{t("captures.retryHelp")}</p>}
          <Button variant="primary" type="submit" data-testid="capture-save"
            disabled={sending || !bodyValid(draft.body) || draft.phase === "saved" || draft.phase === "conflict"}>
            {t(sending ? "captures.saving" : draft.phase === "unknown" ? "captures.retry" : "captures.save")}
          </Button>
          {draft.phase === "conflict" && <Button variant="ghost" data-testid="capture-conflict-new" onClick={keepConflictAsNewDraft}>{t("captures.conflictNew")}</Button>}
          {draft.phase === "saved" && <Button variant="ghost" onClick={clearSaved}>{t("captures.clearSaved")}</Button>}
        </form>
        <section aria-labelledby="capture-inbox-title" className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 id="capture-inbox-title" className="text-lg font-semibold">{t("captures.inbox")}</h2>
            <Button variant="ghost" disabled={loading} onClick={() => { setCursor(null); setRefresh((value) => value + 1); }}>{t("captures.refresh")}</Button>
          </div>
          {loading && <p role="status">{t("app.loading")}</p>}
          {inboxFailed && <p role="alert">{t("captures.loadFailed")}</p>}
          <div data-testid="capture-inbox" aria-busy={loading} className="space-y-3">
            {inbox?.captures.map((capture) => (
              <article key={capture.id} data-capture-id={capture.id} className="rounded-md border border-border p-4 space-y-2">
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{capture.body}</p>
                <p className="text-sm text-ink-2">{t("captures.saved")} · {t(capture.exported_commit ? "captures.exported" : "captures.pendingExport")}</p>
                <time data-mask="time" className="block text-sm text-ink-2" dateTime={capture.created_at}>{capture.created_at}</time>
              </article>
            ))}
            {inbox?.captures.length === 0 && <p>{t("captures.empty")}</p>}
          </div>
          {inbox?.next_cursor && <Button data-testid="capture-more" variant="ghost" disabled={loading} onClick={() => setCursor(inbox.next_cursor)}>{t("captures.more")}</Button>}
        </section>
      </div>
    </section>
  );
}
