import type { ServerMessage } from "../../api/types";
import type { PendingSend, RoomTimeline } from "../../sync/types";
import { dateKey } from "../../ui/time";

export type TimelineItem =
  | { kind: "top"; key: "top" }
  | { kind: "date"; key: string; date: string }
  | { kind: "message"; key: string; row: ServerMessage; groupHead: boolean }
  | { kind: "pending"; key: string; pending: PendingSend; groupHead: boolean };

const GROUP_MS = 300_000;

/** Groups, date dividers and pending rows. Only `message` rows are shown; traces keep their seq but no row (BR-30). */
export function buildItems(t: RoomTimeline, meId: string, timeZone: string): TimelineItem[] {
  const items: TimelineItem[] = [{ kind: "top", key: "top" }];
  let prev: ServerMessage | null = null;
  for (const seq of t.seqs) {
    const row = t.rows[seq];
    if (!row || row.kind !== "message") continue;
    const d = dateKey(row.created_at, timeZone);
    let groupHead: boolean;
    if (prev === null || dateKey(prev.created_at, timeZone) !== d) {
      items.push({ kind: "date", key: "d:" + d, date: d });
      groupHead = true;
    } else {
      groupHead = !(prev.sender_id === row.sender_id && Date.parse(row.created_at) - Date.parse(prev.created_at) < GROUP_MS);
    }
    items.push({ kind: "message", key: "s:" + row.seq, row, groupHead });
    prev = row;
  }
  for (const p of t.pending) {
    const last = items[items.length - 1];
    const joins = last?.kind === "pending" || (last?.kind === "message" && last.row.sender_id === meId);
    items.push({ kind: "pending", key: "p:" + p.clientMessageId, pending: p, groupHead: !joins });
  }
  return items;
}
