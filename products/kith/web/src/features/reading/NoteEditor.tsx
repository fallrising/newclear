import { useEffect, useRef, useState, type ReactElement } from "react";
import { apiFetch, ApiError } from "../../api/client";
import { useT, type CopyKey } from "../../copy";
import { Markdown } from "../../markdown/Markdown";
import { Button } from "../../ui/Button";

type Note = { id: string; article_id: string; body: string; revision: number; updated_at: string; exported_commit: string | null };
type Phase = "loading" | "ready" | "saved" | "saving" | "unknown" | "conflict" | "loadFailed";
type Snapshot = { body: string; revision: number };
export type NoteDraft = { body: string; note: Note | null; phase: Phase; pending: Snapshot | null };
const TIMEOUT_MS = 15_000;

function validBody(body: string): boolean {
  return body.length > 0 && new TextEncoder().encode(body).length <= 16384 &&
    !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(body);
}

function validNote(value: unknown, articleId: string): value is Note {
  if (value === null || typeof value !== "object") return false;
  const note = value as Partial<Note>;
  return typeof note.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(note.id) &&
    note.article_id === articleId && typeof note.body === "string" && validBody(note.body) &&
    Number.isSafeInteger(note.revision) && note.revision! > 0 && typeof note.updated_at === "string" &&
    (note.exported_commit === null || typeof note.exported_commit === "string" && /^[a-f0-9]{40}$/.test(note.exported_commit));
}

export function NoteEditor({ articleId, drafts }: { articleId: string; drafts: Map<string, NoteDraft> }): ReactElement {
  const t = useT();
  const [initial] = useState(() => drafts.get(articleId));
  const [body, setBody] = useState(initial?.body ?? "");
  const [note, setNote] = useState<Note | null>(initial?.note ?? null);
  const [phase, setPhase] = useState<Phase>(initial?.phase ?? "loading");
  const [reload, setReload] = useState(0);
  const pending = useRef<Snapshot | null>(initial?.pending ?? null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const latest = useRef<NoteDraft>({ body, note, phase, pending: pending.current });
  latest.current = { body, note, phase, pending: pending.current };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      const value = latest.current;
      // Preserve drafts across article navigation within this operator session.
      // A request aborted after submission has an uncertain outcome.
      if (pending.current || value.body !== (value.note?.body ?? "")) {
        drafts.set(articleId, { ...value, pending: pending.current, phase: value.phase === "saving" ? "unknown" : value.phase });
      } else drafts.delete(articleId);
    };
  }, []);

  useEffect(() => {
    if (reload === 0 && initial && initial.phase !== "loading") return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    let active = true;
    setPhase("loading");
    void apiFetch<{ note: unknown }>("/api/notes/" + encodeURIComponent(articleId), { signal: controller.signal })
      .then((result) => {
        if (!result || !(result.note === null || validNote(result.note, articleId))) throw new Error("invalid note");
        if (!active) return;
        const current = result.note;
        setNote(current);
        setBody(current?.body ?? "");
        pending.current = null;
        setPhase("ready");
      })
      .catch(() => { if (active) setPhase("loadFailed"); })
      .finally(() => { window.clearTimeout(timeout); if (request.current === controller) request.current = null; });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [articleId, reload, initial]);

  async function save(): Promise<void> {
    if (request.current || phase === "conflict" || phase === "loading" || phase === "loadFailed" || !validBody(body)) return;
    // An uncertain result must replay the same body and expected revision.
    const snapshot = pending.current ?? { body, revision: note?.revision ?? 0 };
    pending.current = snapshot;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    setPhase("saving");
    try {
      const result = await apiFetch<{ note: unknown }>("/api/notes/" + encodeURIComponent(articleId), {
        method: "PUT", body: snapshot, signal: controller.signal,
      });
      if (!result || !validNote(result.note, articleId) || result.note.body !== snapshot.body || result.note.revision !== snapshot.revision + 1) {
        throw new Error("invalid note response");
      }
      if (!mounted.current) return;
      setNote(result.note);
      pending.current = null;
      setPhase("saved");
    } catch (error) {
      if (!mounted.current) return;
      setPhase(error instanceof ApiError && error.status === 409 && error.code === "note_conflict" ? "conflict" : "unknown");
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }

  const statuses: Record<Phase, CopyKey> = {
    loading: "app.loading", ready: "reading.noteReady", saved: "reading.noteSaved", saving: "reading.noteSaving",
    unknown: "reading.noteUnknown", conflict: "reading.noteConflict", loadFailed: "reading.noteLoadFailed",
  };
  const locked = phase === "loading" || phase === "saving" || phase === "unknown" || phase === "conflict" || phase === "loadFailed";
  return (
    <section className="space-y-3" aria-labelledby="note-title">
      <h2 id="note-title" className="text-lg font-semibold">{t("reading.noteTitle")}</h2>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label htmlFor="note-body" className="block font-medium">{t("reading.noteBody")}</label>
        <textarea id="note-body" data-testid="note-body" data-revision={note?.revision ?? 0} value={body} readOnly={locked}
          rows={7} maxLength={16384} aria-describedby="note-status note-limit"
          className="block w-full resize-y rounded-md border border-border bg-bg p-3 text-ink focus-visible:outline-2 focus-visible:outline-focus"
          onChange={(event) => { setBody(event.target.value); setPhase("ready"); }} />
        <p id="note-limit" className="text-sm text-ink-2">{t("captures.limit")}</p>
        {body && !validBody(body) && <p role="alert">{t("captures.invalid")}</p>}
        <p id="note-status" data-testid="note-status" role="status" aria-live="polite">{t(statuses[phase])}</p>
        {note && <p className="text-sm text-ink-2">{t("reading.noteRevision", { revision: note.revision })} · {t(note.exported_commit ? "captures.exported" : "captures.pendingExport")}</p>}
        <Button type="submit" variant="primary" data-testid="note-save"
          disabled={phase === "saving" || phase === "loading" || phase === "loadFailed" || phase === "conflict" || !validBody(body) || phase === "saved"}>
          {t(phase === "unknown" ? "reading.noteRetry" : "reading.noteSave")}
        </Button>
        {(phase === "conflict" || phase === "loadFailed") && <Button data-testid="note-reload" variant="ghost" onClick={() => setReload((value) => value + 1)}>
          {t(phase === "conflict" ? "reading.noteReload" : "error.retry")}
        </Button>}
      </form>
      {body && <details><summary className="cursor-pointer text-ink-2">{t("reading.notePreview")}</summary>
        <div data-testid="note-preview" className="pt-3 space-y-2 break-words [overflow-wrap:anywhere]"><Markdown source={body} mentionHandles={[]} reading /></div>
      </details>}
    </section>
  );
}
