import { useCallback, useEffect, useState } from "react";

import type { SessionId } from "./contracts/SessionId";
import { CanvasSurface, pickNextPosition } from "./surfaces/canvas";
import { vaultRoot } from "./surfaces/document";

export function App() {
  const [vault, setVault] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pending add-node requests handed to the canvas. The canvas owns the
  // spawn / open IPC and calls onConsumedAdd back.
  const [pendingTerminal, setPendingTerminal] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pendingDoc, setPendingDoc] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const [placementSeq, setPlacementSeq] = useState(0);

  const [showOpen, setShowOpen] = useState(false);
  const [openInput, setOpenInput] = useState("notes.md");

  const [activeTerminalId, setActiveTerminalId] = useState<SessionId | null>(
    null,
  );

  useEffect(() => {
    void (async () => {
      try {
        setVault(await vaultRoot());
      } catch {
        // ignore
      }
    })();
  }, []);

  const onAddTerminal = useCallback(() => {
    setBusy(true);
    setError(null);
    const pos = pickNextPosition(placementSeq);
    setPlacementSeq((n) => n + 1);
    setPendingTerminal(pos);
  }, [placementSeq]);

  const onAddDocument = () => setShowOpen(true);

  const confirmOpenDoc = () => {
    const trimmed = openInput.trim();
    if (!trimmed) return;
    const pos = pickNextPosition(placementSeq);
    setPlacementSeq((n) => n + 1);
    setPendingDoc({ x: pos.x, y: pos.y, path: trimmed });
    setShowOpen(false);
  };

  const onConsumedAdd = useCallback(() => {
    setPendingTerminal(null);
    setPendingDoc(null);
    setBusy(false);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <strong>Loom</strong>
        {vault && <span className="meta">vault = {vault}</span>}
        <div className="app-header-section">
          <button onClick={onAddTerminal} disabled={busy}>
            + terminal
          </button>
          <button onClick={onAddDocument}>+ document</button>
        </div>
        {activeTerminalId && (
          <span className="meta">active = {activeTerminalId}</span>
        )}
        {error && <span className="meta">err: {error}</span>}
      </header>

      {showOpen && (
        <div className="open-doc-prompt">
          <label>
            path (relative to vault or absolute):
            <input
              autoFocus
              value={openInput}
              onChange={(e) => setOpenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmOpenDoc();
                if (e.key === "Escape") setShowOpen(false);
              }}
            />
          </label>
          <button onClick={confirmOpenDoc}>open</button>
          <button onClick={() => setShowOpen(false)}>cancel</button>
        </div>
      )}

      <div className="canvas-host">
        <CanvasSurface
          addTerminalAt={pendingTerminal}
          addDocumentAt={pendingDoc}
          onConsumedAdd={onConsumedAdd}
          onActiveTerminalChange={setActiveTerminalId}
        />
      </div>
    </div>
  );
}
