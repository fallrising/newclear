import { useEffect, useRef, useState } from "react";

import type { Event as LoomEvent } from "../../contracts/Event";
import type { FsChangeKind } from "../../contracts/FsChangeKind";
import type { SessionId } from "../../contracts/SessionId";
import type { ContextSource } from "../canvas/edges";
import * as ipc from "../../ipc";

import * as ai from "./ai_ipc";
import { aiSetupProblem } from "./ai_settings";
import * as doc from "./doc_ipc";
import { createEditor, type EditorHandle } from "./editor";
import { readRunIn } from "./frontmatter";
import { blockKey } from "./runnable_block";
import { STRINGS, CSS } from "./config";
import { DocumentLifecycle, DocumentReadGate } from "./lifecycle";
import { collectContext } from "./ai_lifecycle";
import { AiRequestLifecycle } from "./ai_request_lifecycle";

interface DocumentSurfaceProps {
  /// Vault-relative or absolute path to open.
  path: string;
  /// Notify the parent (App) when the user closes the document.
  onClose: () => void;
  /// First step of D-6's execution-target resolution chain (minimal):
  /// the currently-active terminal session, if any. Without `run_in`
  /// frontmatter or a `triggers` edge, this is the implicit target.
  /// Null ⇒ ▶ shows a "spawn a terminal first" toast.
  activeTerminalId: SessionId | null;
  /// Reports the current `run_in:` frontmatter value upstream so the
  /// canvas can materialize a synthetic `triggers` edge (D-6 step 1).
  /// Fires on load and on subsequent edits.
  onRunInChange?: (name: string | null) => void;
  /// Sources (docs and/or terminal scrollbacks) whose content should be
  /// pinned into the AI prompt, derived from incoming `context_for`
  /// edges on the canvas. Docs are fetched via `doc_read`; terminals via
  /// `pty_scrollback`. The panel refreshes all requested sources at send.
  pinnedContextSources?: ContextSource[];
}

type ConflictState =
  | { kind: "none" }
  | { kind: "pending"; lastSeenHash: string };

export function DocumentSurface({
  path,
  onClose,
  activeTerminalId,
  onRunInChange,
  pinnedContextSources,
}: DocumentSurfaceProps) {
  // Track the latest reported run_in so we only fire onRunInChange when
  // it actually changes (frontmatter edits typically don't touch it).
  const lastRunInRef = useRef<string | null>(null);
  const onRunInChangeRef = useRef<typeof onRunInChange>(onRunInChange);
  useEffect(() => {
    onRunInChangeRef.current = onRunInChange;
  }, [onRunInChange]);
  const reportRunIn = (source: string) => {
    const next = readRunIn(source);
    if (next === lastRunInRef.current) return;
    lastRunInRef.current = next;
    onRunInChangeRef.current?.(next);
  };
  // The current activeTerminalId can change after the editor has been
  // created (user clicks "kill" then "spawn shell" again). The editor's
  // onRun closure captures it once, so keep an up-to-date ref the handler
  // dereferences at fire time.
  const activeTerminalRef = useRef<SessionId | null>(activeTerminalId);
  useEffect(() => {
    activeTerminalRef.current = activeTerminalId;
  }, [activeTerminalId]);

  // Which runnable block is currently capturing pty:io (TDD §8 step 4 —
  // live output under the block). Set when ▶ fires; cleared by a
  // subsequent ▶ on a different block. Capture is gated **only** on the
  // target session matching — `feeds_output_to` is NOT consulted here;
  // it's reserved for the Pin-snapshot path (TDD §8 step 5).
  const activeCaptureRef = useRef<{
    bodyKey: string;
    sessionId: SessionId;
  } | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const lifecycleRef = useRef(new DocumentLifecycle());
  const buffer = lifecycleRef.current;
  const readGateRef = useRef(new DocumentReadGate());
  const documentGenerationRef = useRef(0);
  const backendStateQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const syncBackend = (snapshot?: doc.DocSnapshot) => {
    const generation = documentGenerationRef.current;
    const documentPath = snapshot?.path ?? buffer.path;
    const current = () => generation === documentGenerationRef.current && buffer.path === documentPath;
    const operation = backendStateQueueRef.current.then(async () => {
      if (!current()) return;
      if (snapshot) await doc.docOpen(snapshot.path, snapshot.on_disk_hash);
      if (!current() || !documentPath) return;
      if (buffer.dirty) await doc.docMarkDirty(documentPath);
      else await doc.docMarkClean(documentPath);
    });
    backendStateQueueRef.current = operation.catch((e) => {
      if (current()) flash(`document state error: ${String(e)}`);
    });
    return operation;
  };

  const [status, setStatus] = useState<
    "loading" | "missing" | "ready" | "error"
  >("loading");
  const statusRef = useRef(status);
  statusRef.current = status;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<ConflictState>({ kind: "none" });
  const [toast, setToast] = useState<string | null>(null);

  // AI panel
  const [aiOpen, setAiOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<ai.AiStatus | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiRequestId, setAiRequestId] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiLifetimeRef = useRef<{
    requests: AiRequestLifecycle;
    ready: Promise<void>;
  } | null>(null);

  // Fetched bodies of incoming context_for edges. Re-fetched whenever the
  // canvas-resolved set of pinned doc paths changes. Source = relative
  // path; we ship the path as the `source` label so the model can refer
  // to documents by name in its answer.
  const [pinnedContextBodies, setPinnedContextBodies] = useState<
    ai.PinnedContext[]
  >([]);
  const pinnedKey = (pinnedContextSources ?? [])
    .map((s) => (s.kind === "doc" ? `d:${s.path}` : `t:${s.sessionId}`))
    .join(" ");
  useEffect(() => {
    let cancelled = false;
    if (!pinnedContextSources || pinnedContextSources.length === 0) {
      setPinnedContextBodies([]);
      return;
    }
    (async () => {
      const out: ai.PinnedContext[] = [];
      for (const src of pinnedContextSources) {
        try {
          if (src.kind === "doc") {
            const snapshot = await doc.docRead(src.path);
            out.push({
              source: `doc:${src.path}`,
              content: snapshot.content,
            });
          } else {
            const text = await ipc.ptyScrollback(src.sessionId);
            out.push({
              source: `term:${src.label}`,
              content: text,
            });
          }
        } catch {
          // Skip unreadable sources; the chip simply won't appear.
        }
      }
      if (!cancelled) setPinnedContextBodies(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [pinnedKey, pinnedContextSources]);

  // Flash a toast for a few seconds.
  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  };

  // Pull AI status (key present, model) on mount.
  useEffect(() => {
    void (async () => {
      try {
        setAiStatus(await ai.aiStatus());
      } catch {
        /* ignore — UI handles null status */
      }
    })();
  }, []);

  // Listen for streamed AI chunks targeted at *our* in-flight request.
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    setAiBusy(false);
    setAiRequestId(null);
    const deliver = (ev: ai.AiEvent) => {
      if (!alive) return;
      switch (ev.kind) {
        case "started": editorRef.current?.insertAtCursor("\n\n> 🤖 "); break;
        case "text": editorRef.current?.insertAtCursor(ev.delta.replace(/\n/g, "\n> ")); break;
        case "done":
          editorRef.current?.insertAtCursor(
            `\n\n_(input ${ev.usage.input_tokens}, output ${ev.usage.output_tokens}` +
            (ev.usage.cache_read_input_tokens > 0 ? `, cache hit ${ev.usage.cache_read_input_tokens}` : "") + `)_\n\n`,
          );
          flash("AI done");
          break;
        case "error": editorRef.current?.insertAtCursor(`\n\n_(AI error: ${ev.message})_\n\n`); break;
        case "cancelled": editorRef.current?.insertAtCursor("\n\n_(cancelled)_\n\n"); break;
      }
    };
    const requests = new AiRequestLifecycle(ai.aiCancel, deliver, (state) => {
      setAiBusy(state.busy);
      setAiRequestId(state.requestId);
    }, (error, operation) => {
      flash(`AI ${operation} failed: ${String(error)}`);
    });
    const ready = (async () => {
      const unlisten = await ai.onAiEvent((ev) => requests.accept(ev));
      if (!alive) { unlisten(); throw new Error("AI listener disposed"); }
      off = unlisten;
    })();
    const lifetime = { requests, ready };
    aiLifetimeRef.current = lifetime;
    void ready.catch(() => { /* submission surfaces listener failure */ });
    return () => {
      alive = false;
      requests.close();
      off?.();
      if (aiLifetimeRef.current === lifetime) aiLifetimeRef.current = null;
    };
  }, [path]);

  const submitAiPrompt = async () => {
    if (aiSetupProblem(aiStatus) || !aiPrompt.trim()) return;
    const lifetime = aiLifetimeRef.current;
    if (!lifetime) return;
    await lifetime.requests.submit(
      lifetime.ready,
      () => collectContext(pinnedContextSources ?? [], doc.docRead, ipc.ptyScrollback),
      (context) => {
        setPinnedContextBodies(context);
        const docText = editorRef.current?.view.state.doc.toString() ?? "";
        return ai.aiAsk(aiPrompt, docText || null, context);
      },
      () => setAiPrompt(""),
    );
  };

  const cancelAi = async () => {
    await aiLifetimeRef.current?.requests.cancel();
  };

  // Save through the backend. Returns true iff bytes hit disk.
  const save = async (): Promise<boolean> => {
    if (!editorRef.current || !buffer.path || statusRef.current !== "ready" || buffer.creating) return false;
    const generation = documentGenerationRef.current;
    const revision = buffer.revision;
    readGateRef.current.invalidate();
    try {
      const outcome = await buffer.save(() => {
        if (!editorRef.current) throw new Error("Document editor was closed before save");
        return editorRef.current.view.state.doc.toString();
      }, doc.docWrite);
      if (documentGenerationRef.current !== generation || buffer.revision !== revision) return outcome.kind === "written";
      readGateRef.current.invalidate();
      if (outcome.kind === "conflict") {
        setConflict({ kind: "pending", lastSeenHash: outcome.current_disk_hash });
        flash("Save blocked: on-disk hash drifted");
        return false;
      }
      setDirty(buffer.dirty);
      setConflict({ kind: "none" });
      await syncBackend({ path: buffer.path, content: "", on_disk_hash: outcome.new_hash });
      if (generation !== documentGenerationRef.current) return true;
      flash(buffer.dirty ? "saved earlier version — newer edits remain unsaved" : "saved");
      return true;
    } catch (e) {
      if (documentGenerationRef.current !== generation || buffer.revision !== revision) return false;
      setError(String(e));
      flash(`save error: ${String(e)}`);
      return false;
    }
  };

  const mountEditor = (content: string) => {
    const host = hostRef.current;
    if (!host || editorRef.current) return;
    const handle = createEditor({
      parent: host,
      initialContent: content,
      onChange: (next) => {
        const wasDirty = buffer.dirty;
        buffer.edit();
        setDirty(true);
        if (!wasDirty) void syncBackend();
        // Cheap re-parse: only the first ~200 bytes matter for
        // frontmatter; readRunIn bails fast when no fence is present.
        reportRunIn(next);
      },
      onSave: () => {
        void save();
      },
      onRun: (req) => {
        const target = activeTerminalRef.current;
        if (!target) {
          flash("no active terminal — click 'spawn shell' first");
          return;
        }
        // TDD §8 step 4: post-▶ output flows into the clicked block's
        // output section automatically. No edge required — the routing
        // is "this block, this run, this terminal." `feeds_output_to`
        // is reserved for the Pin-snapshot path (step 5, future).
        const key = blockKey(req.body);
        activeCaptureRef.current = { bodyKey: key, sessionId: target };
        editorRef.current?.clearOutput(key);
        // Shell line-discipline expects CR (\r) to mean "submit a
        // command." Map every \n in the body to \r, append a final
        // \r so the last (and possibly only) line runs, and prepend
        // `cd <cwd>\r` when the block specified one (Min-D-6 B).
        //
        // Single-quoting the cwd lets the user pass paths with shell
        // metacharacters safely; embedded single quotes are escaped
        // using the standard `'\''` idiom.
        const cdPrefix = req.cwd
          ? `cd '${req.cwd.replace(/'/g, "'\\''")}'\r`
          : "";
        const payload = cdPrefix + req.body.replace(/\n/g, "\r") + "\r";
        ipc.writeStdin(target, payload).then(
          () => {
            const preview = req.body.split("\n", 1)[0]?.slice(0, 60) ?? "";
            const where = req.cwd ? ` @ ${req.cwd}` : "";
            flash(`▶ injected → ${target}${where}: ${preview}`);
          },
          (e) => flash(`inject failed: ${String(e)}`),
        );
      },
      onRefClick: (hit) => {
        flash(
          hit.id
            ? `[[${hit.file}#^${hit.id}]] — link resolution lands in C4`
            : `[[${hit.file}]] — link resolution lands in C4`,
        );
      },
    });
    editorRef.current = handle;
  };

  const applySnapshot = async (snapshot: doc.DocSnapshot) => {
    buffer.load(snapshot);
    if (editorRef.current) editorRef.current.replaceDoc(snapshot.content);
    else mountEditor(snapshot.content);
    setCreating(false);
    setError(null);
    reportRunIn(snapshot.content);
    setDirty(false);
    setConflict({ kind: "none" });
    setStatus("ready");
    await syncBackend(snapshot);
  };

  // Mount the editor once content is loaded.
  useEffect(() => {
    let disposed = false;
    documentGenerationRef.current++;
    setStatus("loading");
    setCreating(false);
    setError(null);
    setDirty(false);
    setConflict({ kind: "none" });
    void (async () => {
      try {
        let snap: doc.DocSnapshot;
        try {
          snap = await doc.docRead(path);
        } catch (e) {
          // Treat "not found" as a chance to create a new file.
          const msg = String(e);
          if (disposed) return;
          if (msg.toLowerCase().includes("not found")) {
            buffer.missing(path);
            setStatus("missing");
            return;
          }
          throw e;
        }
        if (disposed) return;
        const host = hostRef.current;
        if (!host) return;
        buffer.load(snap);
        void syncBackend(snap);
        // Report the initial run_in before the user has touched anything.
        reportRunIn(snap.content);

        mountEditor(snap.content);
        setStatus("ready");
      } catch (e) {
        if (disposed) return;
        setStatus("error");
        setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      documentGenerationRef.current++;
      readGateRef.current.invalidate();
      buffer.close();
      editorRef.current?.destroy();
      editorRef.current = null;
      const closedPath = buffer.path || path;
      backendStateQueueRef.current = backendStateQueueRef.current.then(() => doc.docClose(closedPath)).catch(() => undefined);
    };
  }, [path]);

  // Listen for pty:io batches: append to the active capture block if
  // the batch is from the session ▶ targeted. No feeds_output_to gate —
  // that edge belongs to the Pin path, not live capture.
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    void (async () => {
      const unlisten = await ipc.onPtyIo((batch) => {
        const cap = activeCaptureRef.current;
        if (!cap) return;
        if (batch.session_id !== cap.sessionId) return;
        const text = batch.frames.join("");
        if (!text) return;
        editorRef.current?.appendOutput(cap.bodyKey, text);
      });
      if (!alive) {
        unlisten();
        return;
      }
      off = unlisten;
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // Listen for FsChanged events affecting this path.
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    void (async () => {
      const unlisten = await ipc.onLoomEvent(async (ev: LoomEvent) => {
        if (ev.kind !== "fs_changed") return;
        if (ev.path !== buffer.path) return;
        if (!alive || buffer.creating) return;
        const c: FsChangeKind = ev.change;
        if (c.kind === "deleted") {
          readGateRef.current.invalidate();
          documentGenerationRef.current++;
          buffer.invalidate();
          setCreating(false);
          setError(null);
          setStatus("missing");
          return;
        }
        if (statusRef.current === "missing" || buffer.creating) return;
        try {
          const version = buffer.version;
          const fresh = await readGateRef.current.read(() => doc.docRead(buffer.path));
          if (!alive || !fresh || buffer.saving) return;
          if (buffer.version !== version && !buffer.dirty) return;
          if (buffer.dirty) {
            if (fresh.on_disk_hash !== buffer.hash) {
              setConflict({ kind: "pending", lastSeenHash: fresh.on_disk_hash });
            }
          } else {
            await applySnapshot(fresh);
            flash("reloaded from disk");
          }
        } catch (e) { if (alive) flash(`reload failed: ${String(e)}`); }

      });
      if (!alive) {
        unlisten();
        return;
      }
      off = unlisten;
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, [path]);

  const reloadFromDisk = async () => {
    const generation = documentGenerationRef.current;
    if (!buffer.invalidate()) return;
    setCreating(false);
    try {
      const fresh = await readGateRef.current.read(() => doc.docRead(buffer.path || path));
      if (!fresh || generation !== documentGenerationRef.current) return;
      await applySnapshot(fresh);
      if (generation !== documentGenerationRef.current) return;
      flash("reloaded — your edits are gone");
    } catch (e) {
      if (generation !== documentGenerationRef.current) return;
      setError(String(e));
      flash(`reload failed: ${String(e)}`);
    }
  };

  const createDocument = async () => {
    if (buffer.creating || statusRef.current !== "missing") return;
    const generation = documentGenerationRef.current;
    readGateRef.current.invalidate();
    setCreating(true);
    setError(null);
    try {
      const snapshot = await buffer.create(editorRef.current?.view.state.doc.toString() ?? "", doc.docCreate);
      if (!snapshot || generation !== documentGenerationRef.current) return;
      // The acknowledgement is exactly the submitted version. Keep the live
      // editor (including anything typed while pending), and never re-read.
      mountEditor(snapshot.content);
      reportRunIn(editorRef.current?.view.state.doc.toString() ?? snapshot.content);
      setDirty(buffer.dirty);
      setConflict({ kind: "none" });
      statusRef.current = "ready";
      setStatus("ready");
      await syncBackend(snapshot);
    } catch (e) {
      if (generation !== documentGenerationRef.current) return;
      setError(buffer.createError ?? String(e));
    } finally {
      if (generation === documentGenerationRef.current) setCreating(buffer.creating);
    }
  };

  const keepEditing = () => {
    if (conflict.kind !== "pending") return;
    buffer.keep(conflict.lastSeenHash);
    setConflict({ kind: "none" });
    flash("keeping edits — next save checks the confirmed disk version");
  };

  return (
    <div className="document-surface">
      <div className="document-header">
        <strong>{path}</strong>
        {dirty && <span className="document-dirty">●</span>}
        <button onClick={() => void save()} disabled={status !== "ready" || creating}>
          save
        </button>
        <button
          onClick={() => setAiOpen((v) => !v)}
          className={aiOpen ? "loom-ai-toggle open" : "loom-ai-toggle"}
        >
          🤖 ask AI
        </button>
        <button onClick={onClose}>close</button>
        {toast && <span className="document-toast">{toast}</span>}
      </div>
      {aiOpen && (
        <div className="loom-ai-panel">
          {aiSetupProblem(aiStatus) ? (
            <div className="loom-ai-empty" role="alert">
              {aiSetupProblem(aiStatus)}
            </div>
          ) : aiStatus && (
            <>
              <div className="loom-ai-context">
                provider: <code>{aiStatus.provider}</code> · model:{" "}
                <code>{aiStatus.model}</code> · context: this doc (~
                {Math.ceil(
                  (editorRef.current?.view?.state.doc.length ?? 0) / 4,
                )}{" "}
                tokens)
              </div>
              {pinnedContextBodies.length > 0 && (
                <div className="loom-ai-pinned">
                  pinned context preview (refreshed at send):{" "}
                  {pinnedContextBodies.map((pc, idx) => (
                    <span key={pc.source} className="loom-ai-pinned-chip">
                      <code>{pc.source}</code>{" "}
                      (~{Math.ceil(pc.content.length / 4)}t)
                      {idx < pinnedContextBodies.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              )}
              <textarea
                className="loom-ai-prompt nodrag"
                placeholder="Ask the AI to expand, revise, or annotate this document. Cmd+Enter to send."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submitAiPrompt();
                  }
                }}
                disabled={aiBusy}
                rows={3}
              />
              <div className="loom-ai-actions">
                {aiRequestId ? (
                  <button onClick={() => void cancelAi()}>cancel</button>
                ) : (
                  <button
                    onClick={() => void submitAiPrompt()}
                    disabled={!aiPrompt.trim() || aiBusy}
                  >
                    send (⌘↵)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {conflict.kind === "pending" && (
        <div className={CSS.conflictBanner}>
          <div>
            <strong>{STRINGS.conflictTitle}</strong>
            <p>{STRINGS.conflictBody}</p>
          </div>
          <div className="document-conflict-actions">
            <button onClick={() => void reloadFromDisk()}>
              {STRINGS.conflictReload}
            </button>
            <button onClick={keepEditing}>{STRINGS.conflictKeep}</button>
          </div>
        </div>
      )}
      {status === "missing" && (
        <div className="document-missing">
          <p>
            <code>{path}</code> doesn't exist yet.
          </p>
          <button onClick={() => void createDocument()} disabled={creating} aria-busy={creating}>
            {creating ? "creating…" : error ? "retry creation" : editorRef.current ? "recreate with current edits" : "create empty file"}
          </button>
          <button onClick={() => void reloadFromDisk()} disabled={creating}>
            reload from disk (discard edits)
          </button>
          {error && <p className="document-error" role="alert">{error}</p>}
        </div>
      )}
      {status === "error" && (
        <div className="document-error">error: {error}</div>
      )}
      <div ref={hostRef} className="document-editor-host" />
    </div>
  );
}
