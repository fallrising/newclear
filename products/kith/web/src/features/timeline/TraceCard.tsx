import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { useRef, useState, type ReactElement } from "react";
import { fetchTraceFull } from "../../api/rooms";
import type { ServerMessage } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";

function firstLine(body: string): string {
  const index = body.indexOf("\n");
  return index === -1 ? body : body.slice(0, index);
}

/** Folded work log (UJ-10). Full text is fetched once, only after trace-load-full (B-13). */
export function TraceCard(props: { roomId: string; row: ServerMessage; senderName: string }): ReactElement {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<string | null | undefined>(undefined);
  const asked = useRef(false);
  const load = (): void => {
    if (asked.current) return;
    asked.current = true;
    void fetchTraceFull(props.roomId, props.row.id).then(
      (text) => setFull(text),
      () => {
        asked.current = false;
      },
    );
  };
  return (
    <div
      data-testid="trace-card"
      data-id={props.row.id}
      className="ml-12 flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2"
    >
      <button
        type="button"
        data-testid="trace-toggle"
        aria-expanded={open}
        aria-label={t("trace.label") + " " + props.senderName}
        className="flex items-center gap-2 text-left text-sm text-ink-2"
        onClick={() => setOpen((value) => !value)}
      >
        <Terminal size={16} strokeWidth={1.75} aria-hidden />
        <span className="font-medium text-ink">{props.senderName}</span>
        <span className="truncate">{firstLine(props.row.body)}</span>
        {open ? (
          <ChevronUp size={16} strokeWidth={1.75} aria-hidden />
        ) : (
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
        )}
      </button>
      {open && (
        <pre data-testid="trace-summary" className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink">
          {props.row.body}
        </pre>
      )}
      {open && full === undefined && (
        <Button variant="ghost" data-testid="trace-load-full" onClick={load}>
          {t("trace.loadFull")}
        </Button>
      )}
      {open && full === null && (
        <p data-testid="trace-full-unavailable" className="text-xs text-ink-3">
          {t("trace.fullUnavailable")}
        </p>
      )}
      {open && typeof full === "string" && (
        <pre data-testid="trace-full" className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink">
          {full}
        </pre>
      )}
    </div>
  );
}
