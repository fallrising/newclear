import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import type { SessionId } from "./contracts/SessionId";
import type { StreamId } from "./contracts/StreamId";
import * as ipc from "./ipc";

interface TerminalViewProps {
  sessionId: SessionId;
  onStreamReady?: (streamId: StreamId) => void;
}

export function TerminalView({ sessionId, onStreamReady }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: false,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0d0d0d",
        foreground: "#e6e6e6",
        cursor: "#e6e6e6",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Fit once the element has a size; then on every resize.
    const initialFit = () => {
      try {
        fit.fit();
        void ipc.resizePty(sessionId, term.cols, term.rows);
      } catch {
        // ignore — host may not be measured yet on first tick
      }
    };
    requestAnimationFrame(initialFit);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void ipc.resizePty(sessionId, term.cols, term.rows);
      } catch {
        // ignore — host may be unmeasured during transition
      }
    });
    ro.observe(host);

    // Keystrokes → stdin
    const onDataSub = term.onData((data) => {
      void ipc.writeStdin(sessionId, data);
    });

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const off = await ipc.onPtyIo((batch) => {
        if (batch.session_id !== sessionId) return;
        for (const frame of batch.frames) {
          term.write(frame);
        }
        if (batch.dropped_old > 0) {
          term.write(
            `\r\n\x1b[33m[loom] ${batch.dropped_old} frames evicted from ring buffer\x1b[0m\r\n`,
          );
        }
      });
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;

      // After we're listening, subscribe so the initial replay batch
      // lands on us. Backend emits replay synchronously inside subscribe().
      const streamId = await ipc.subscribe(sessionId);
      onStreamReady?.(streamId);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      onDataSub.dispose();
      ro.disconnect();
      term.dispose();
      void ipc.detach(sessionId);
    };
  }, [sessionId, onStreamReady]);

  return (
    <div className="terminal-host">
      <div ref={hostRef} />
    </div>
  );
}
