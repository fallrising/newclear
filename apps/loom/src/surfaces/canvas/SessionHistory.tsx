import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "../../contracts/SessionMeta";
import * as ipc from "../../ipc";
import { eligibleForRecovery, SessionHistoryController, type HistoryState } from "./history";

const EMPTY: HistoryState = { snapshot: null, loading: true, error: null, pending: new Map(), actionErrors: new Map(), cleanupErrors: new Map() };

function status(session: SessionMeta) {
  switch (session.state.kind) {
    case "tombstone": return session.state.reason;
    case "exited": return session.state.code === null ? "Exited" : `Exited (${session.state.code})`;
    default: return session.state.kind;
  }
}

export function SessionHistory({ canvasReady, onRestarted }: { canvasReady: boolean; onRestarted: (meta: SessionMeta) => boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HistoryState>(EMPTY);
  const controllerRef = useRef<SessionHistoryController | null>(null);
  const attachRef = useRef(onRestarted); attachRef.current = onRestarted;
  const readyRef = useRef(canvasReady); readyRef.current = canvasReady;
  useEffect(() => {
    const controller = new SessionHistoryController({
      listen: ipc.onSessionChanged, read: ipc.sessionHistory, restart: ipc.restartSession,
      forget: ipc.forgetSession, meta: ipc.sessionMeta, kill: ipc.killPty,
    }, setState, (meta) => readyRef.current && attachRef.current(meta));
    controllerRef.current = controller;
    void controller.start();
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, []);
  const snapshot = state.snapshot;
  return <aside className="session-history" aria-label="Session history">
    <button aria-expanded={open} aria-controls="session-history-panel" onClick={() => setOpen((value) => !value)}>Session history{snapshot ? ` (${snapshot.sessions.length})` : ""}</button>
    {snapshot && (!snapshot.persistent || snapshot.warning) && <div className="session-history-warning" role="status">
      {!snapshot.persistent && <strong>History will not survive app restart. </strong>}{snapshot.warning}
    </div>}
    {state.error && <div role="alert" className="session-history-warning">{state.error} <button onClick={() => void controllerRef.current?.refresh()}>Retry history</button></div>}
    {state.cleanupErrors.size > 0 && <div role="alert" className="session-history-warning">
      {Array.from(state.cleanupErrors, ([id, message]) => <div key={id}>{message} <button onClick={() => void controllerRef.current?.retryCleanup(id)}>Retry cleanup</button></div>)}
    </div>}
    {open && <section id="session-history-panel" className="session-history-panel">
      <div className="session-history-heading"><strong>Session history</strong><button disabled={state.loading} onClick={() => void controllerRef.current?.refresh()}>Refresh</button></div>
      <p>Restart reruns the saved command in a new terminal. Forget history keeps canvas nodes and files.</p>
      {snapshot?.persistent && !snapshot.warning && <div className="session-history-status">History saved locally.</div>}
      {state.loading && <div role="status">Loading history…</div>}
      {!canvasReady && <div className="session-history-status">Open the canvas before restarting a session.</div>}
      {snapshot?.sessions.length === 0 && <p>No session history yet.</p>}
      {snapshot && <ul>{snapshot.sessions.map((session) => {
        const pending = state.pending.get(session.id);
        const eligible = eligibleForRecovery(session, snapshot);
        const disabled = !!pending || state.loading || !!state.error;
        const activity = new Date(Number(session.last_activity_ms));
        return <li key={session.id}>
          <code className="session-history-command">{session.cmd ?? session.shell}</code>
          <div className="session-history-cwd">{session.cwd}</div>
          <div className="session-history-status" title={session.id}>{status(session)} · {session.id.slice(0, 8)}{Number.isFinite(activity.getTime()) && <> · <time dateTime={activity.toISOString()}>{activity.toLocaleString()}</time></>}</div>
          {eligible ? <div className="session-history-actions">
            <button disabled={disabled || !canvasReady} onClick={() => void controllerRef.current?.restart(session.id)}>{pending === "restart" ? "Restarting…" : "Restart"}</button>
            <button disabled={disabled} onClick={() => void controllerRef.current?.forget(session.id)}>{pending === "forget" ? "Forgetting…" : "Forget history"}</button>
          </div> : <div className="session-history-status">{snapshot.live_session_ids.includes(session.id) ? "Live session" : "Unavailable for restart"}</div>}
          {pending === "restart" && <button onClick={() => controllerRef.current?.cancel(session.id)}>Cancel restart</button>}
          {state.actionErrors.has(session.id) && <div role="alert">{state.actionErrors.get(session.id)}</div>}
        </li>;
      })}</ul>}
    </section>}
  </aside>;
}
