import type { RoomMember, ServerMessage } from "../../api/types";
import type { Draft } from "../../store/drafts";
import type { ReplyPhase, RoomStatuses } from "../../store/statuses";
import { REPLY_STALE_MS, FAILURE_SHOW_MS } from "../../store/statuses";
import type { PendingSend, RoomTimeline } from "../../sync/types";
import { dateKey } from "../../ui/time";

export type TimelineItem =
  | { kind: "top"; key: "top" }
  | { kind: "date"; key: string; date: string }
  | { kind: "new"; key: "new" }
  | { kind: "message"; key: string; row: ServerMessage; groupHead: boolean }
  | { kind: "pending"; key: string; pending: PendingSend; groupHead: boolean }
  | { kind: "reply"; key: string; memberId: string; draft?: string; phase: ReplyPhase }
  | { kind: "failed"; key: string; memberId: string; errorClass: string | null; blocked: boolean };

const GROUP_MS = 300_000;

/** Groups, date dividers and pending rows. Only `message` rows are shown; traces keep their seq but no row (BR-30). */
export function buildItems(
  t: RoomTimeline,
  meId: string,
  timeZone: string,
  dividerAfterSeq: number | null,
  statuses: RoomStatuses | undefined,
  now: number,
  members: RoomMember[] | undefined,
  drafts: Record<string, Draft> | undefined,
): TimelineItem[] {
  const items: TimelineItem[] = [{ kind: "top", key: "top" }];
  let prev: ServerMessage | null = null;
  let insertedNew = false;
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
    if (!insertedNew && dividerAfterSeq !== null && row.seq > dividerAfterSeq && row.sender_id !== meId) {
      items.push({ kind: "new", key: "new" });
      insertedNew = true;
      groupHead = true;
    }
    items.push({ kind: "message", key: "s:" + row.seq, row, groupHead });
    prev = row;
  }
  for (const p of t.pending) {
    const last = items[items.length - 1];
    const joins = last?.kind === "pending" || (last?.kind === "message" && last.row.sender_id === meId);
    items.push({ kind: "pending", key: "p:" + p.clientMessageId, pending: p, groupHead: !joins });
  }
  const agents = new Set((members ?? []).filter((member) => member.kind === "agent").map((member) => member.id));
  const shown = new Map<string, { at: number; draft?: string; phase?: ReplyPhase }>();
  if (statuses) {
    for (const [id, reply] of Object.entries(statuses.replies)) {
      if (agents.has(id) && now - reply.at < REPLY_STALE_MS) shown.set(id, { at: reply.at, phase: reply.phase });
    }
  }
  for (const [id, draft] of Object.entries(drafts ?? {})) {
    const existing = shown.get(id);
    if (existing) existing.draft = draft.text;
    else shown.set(id, { at: draft.at, draft: draft.text });
  }
  const replies = [...shown.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [id, info] of replies) {
    items.push({ kind: "reply", key: "r:" + id, memberId: id, draft: info.draft, phase: info.phase ?? "replying" });
  }
  if (statuses) {
    for (const [id, failure] of Object.entries(statuses.failures)) {
      if (now - failure.at < FAILURE_SHOW_MS) {
        items.push({ kind: "failed", key: "f:" + id, memberId: id, errorClass: failure.errorClass, blocked: failure.blocked === true });
      }
    }
  }
  return items;
}
