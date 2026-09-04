import { useEffect, useRef, useState } from "react";

import type { Event as LoomEvent } from "../../contracts/Event";
import type { FsChangeKind } from "../../contracts/FsChangeKind";
import type { SessionId } from "../../contracts/SessionId";
import type { ContextSource } from "../canvas/edges";
import * as ipc from "../../ipc";

import * as ai from "./ai_ipc";
import * as doc from "./doc_ipc";
import { createEditor, type EditorHandle } from "./editor";
import { readRunIn } from "./frontmatter";
import { blockKey } from "./runnable_block";
import { STRINGS, CSS } from "./config";

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
  /// `pty_scrollback`. The panel ships the assembled set as cached
  /// context blocks.
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
  const dirtyRef = useRef(false);
  const onDiskHashRef = useRef<string>("");

  const [status, setStatus] = useState<
    "loading" | "missing" | "ready" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<ConflictState>({ kind: "none" });
  const [toast, setToast] = useState<string | null>(null);

  // AI panel
  const [aiOpen, setAiOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<ai.AiStatus | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiRequestId, setAiRequestId] = useState<string | null>(null);
  const aiRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    aiRequestIdRef.current = aiRequestId;
  }, [aiRequestId]);

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
    void (async () => {
      const unlisten = await ai.onAiEvent((ev) => {
        if (ev.request_id !== aiRequestIdRef.current) return;
        switch (ev.kind) {
          case "started":
            // Open a quoted scaffold the streamer can pile into. The
            // cursor lands at the line below `> 🤖`, ready to receive
            // text chunks.
            editorRef.current?.insertAtCursor("\n\n> 🤖 ");
            break;
          case "text":
            // Insert raw delta. Newlines become `\n` continuations of
            // the quoted block; users can clean up after.
            editorRef.current?.insertAtCursor(
              ev.delta.replace(/\n/g, "\n> "),
            );
            break;
          case "done":
            editorRef.current?.insertAtCursor(
              `\n\n_(input ${ev.usage.input_tokens}, output ${ev.usage.output_tokens}` +
                (ev.usage.cache_read_input_tokens > 0
                  ? `, cache hit ${ev.usage.cache_read_input_tokens}`
                  : "") +
                `)_\n\n`,
            );
            setAiRequestId(null);
            flash("AI done");
            break;
          case "error":
            editorRef.current?.insertAtCursor(
              `\n\n_(AI error: ${ev.message})_\n\n`,
            );
            setAiRequestId(null);
            break;
          case "cancelled":
            editorRef.current?.insertAtCursor("\n\n_(cancelled)_\n\n");
            setAiRequestId(null);
            break;
        }
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

  const submitAiPrompt = async () => {
    if (!aiStatus?.key_present) return;
    if (!aiPrompt.trim()) return;
    if (aiRequestId) return;
    try {
      const view = editorRef.current?.view;
      const docText = view ? view.state.doc.toString() : "";
      const id = await ai.aiAsk(aiPrompt, docText || null, pinnedContextBodies);
      setAiRequestId(id);
      setAiPrompt("");
    } catch (e) {
      flash(`AI request failed: ${String(e)}`);
    }
  };

  const cancelAi = async () => {
    if (!aiRequestId) return;
    try {
      await ai.aiCancel(aiRequestId);
    } catch {
      /* ignore */
    }
  };

  // Save through the backend. Returns true iff bytes hit disk.
  const save = async (force = false): Promise<boolean> => {
    const view = editorRef.current?.view;
    if (!view) return false;
    const content = view.state.doc.toString();
    const expected = force ? null : onDiskHashRef.current || null;
    try {
      const outcome = await doc.docWrite(path, content, expected);
      if (outcome.kind === "conflict") {
        setConflict({ kind: "pending", lastSeenHash: outcome.current_disk_hash });
        flash("Save blocked: on-disk hash drifted");
        return false;
      }
      onDiskHashRef.current = outcome.new_hash;
      dirtyRef.current = false;
      setDirty(false);
      setConflict({ kind: "none" });
      void doc.docMarkClean(path);
      flash("saved");
      return true;
    } catch (e) {
      setError(String(e));
      flash(`save error: ${String(e)}`);
      return false;
    }
  };

  // Mount the editor once content is loaded.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        let snap: doc.DocSnapshot;
        try {
          snap = await doc.docRead(path);
        } catch (e) {
          // Treat "not found" as a chance to create a new file.
          const msg = String(e);
          if (msg.toLowerCase().includes("not found")) {
            setStatus("missing");
            return;
          }
          throw e;
        }
        if (disposed) return;
        const host = hostRef.current;
        if (!host) return;
        onDiskHashRef.current = snap.on_disk_hash;
        void doc.docOpen(path, snap.on_disk_hash);
        // Report the initial run_in before the user has touched anything.
        reportRunIn(snap.content);

        const handle = createEditor({
          parent: host,
          initialContent: snap.content,
          onChange: (next) => {
            if (!dirtyRef.current) {
              dirtyRef.current = true;
              setDirty(true);
              void doc.docMarkDirty(path);
            }
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
        setStatus("ready");
      } catch (e) {
        setStatus("error");
        setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      editorRef.current?.destroy();
      editorRef.current = null;
      void doc.docClose(path);
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
        if (ev.path !== path) return;
        const c: FsChangeKind = ev.change;
        if (c.kind === "deleted") {
          setStatus("missing");
          return;
        }
        // For Created / Modified / Renamed: re-check conflict.
        const status = await doc.docCheckConflict(path);
        if (status === "conflict") {
          setConflict({
            kind: "pending",
            lastSeenHash: onDiskHashRef.current,
          });
        } else if (status === "no_conflict" && !dirtyRef.current) {
          // Editor was clean: silently reload bytes.
          try {
            const fresh = await doc.docRead(path);
            onDiskHashRef.current = fresh.on_disk_hash;
            editorRef.current?.replaceDoc(fresh.content);
            flash("reloaded from disk");
          } catch (e) {
            flash(`reload failed: ${String(e)}`);
          }
        }
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
    try {
      const fresh = await doc.docRead(path);
      onDiskHashRef.current = fresh.on_disk_hash;
      editorRef.current?.replaceDoc(fresh.content);
      dirtyRef.current = false;
      setDirty(false);
      setConflict({ kind: "none" });
      void doc.docMarkClean(path);
      flash("reloaded — your edits are gone");
    } catch (e) {
      flash(`reload failed: ${String(e)}`);
    }
  };

  const keepEditing = () => {
    // The user accepted that their next save will overwrite on-disk bytes.
    // We clear the conflict banner but keep `dirty` true; next save uses
    // `force=true` so the optimistic-concurrency check is skipped.
    setConflict({ kind: "none" });
    flash("keeping unsaved edits — next save will overwrite disk");
  };

  return (
    <div className="document-surface">
      <div className="document-header">
        <strong>{path}</strong>
        {dirty && <span className="document-dirty">●</span>}
        <button onClick={() => void save(conflict.kind === "pending")}>
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
          {!aiStatus?.key_present ? (
            <div className="loom-ai-empty">
              <strong>{aiStatus?.key_env ?? "API key"} not set.</strong>{" "}
              <code>export {aiStatus?.key_env ?? "API_KEY"}=…</code> in your
              shell rc, then relaunch Loom. Switch providers via{" "}
              <code>LOOM_AI_PROVIDER=anthropic|openai|deepseek</code>.
            </div>
          ) : (
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
                  pinned context:{" "}
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
                disabled={aiRequestId !== null}
                rows={3}
              />
              <div className="loom-ai-actions">
                {aiRequestId ? (
                  <button onClick={() => void cancelAi()}>cancel</button>
                ) : (
                  <button
                    onClick={() => void submitAiPrompt()}
                    disabled={!aiPrompt.trim()}
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
          <button
            onClick={async () => {
              try {
                await doc.docWrite(path, "", null);
                const fresh = await doc.docRead(path);
                onDiskHashRef.current = fresh.on_disk_hash;
                void doc.docOpen(path, fresh.on_disk_hash);
                setStatus("loading");
                // Re-trigger the load effect by changing a key would be
                // cleaner, but a soft refresh works for v1: replace the
                // mount target's child and re-create the editor.
                window.location.reload();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            create empty file
          </button>
        </div>
      )}
      {status === "error" && (
        <div className="document-error">error: {error}</div>
      )}
      <div ref={hostRef} className="document-editor-host" />
    </div>
  );
}
