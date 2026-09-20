import type { TimelineEvent, WsPacket } from "./types";

export const CLIENT_MESSAGE_ID_MIN = 8;
export const CLIENT_MESSAGE_ID_MAX = 64;

export function newClientMessageId(): string {
  const id = crypto.randomUUID();
  if (id.length >= CLIENT_MESSAGE_ID_MIN && id.length <= CLIENT_MESSAGE_ID_MAX) {
    return id;
  }
  return id.replace(/-/g, "").padEnd(CLIENT_MESSAGE_ID_MIN, "0").slice(0, CLIENT_MESSAGE_ID_MAX);
}

export function lastContinuousSeq(seqs: Iterable<number>): number | null {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  let last = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === last + 1) {
      last = sorted[i];
    } else {
      break;
    }
  }
  return last;
}

export function hasSeqGap(seqs: Iterable<number>): boolean {
  const unique = [...new Set(seqs)].sort((a, b) => a - b);
  if (unique.length === 0) {
    return false;
  }
  const last = lastContinuousSeq(unique);
  return last !== null && unique[unique.length - 1] > last;
}

export function roomWebSocketUrl(roomId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/rooms/${encodeURIComponent(roomId)}/ws`;
}

export function sendPacket(body: string, clientMessageId: string): {
  v: 1;
  type: "send";
  client_message_id: string;
  body: string;
} {
  return { v: 1, type: "send", client_message_id: clientMessageId, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTimelineEvent(raw: unknown): TimelineEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const inner = isRecord(raw.event) ? raw.event : raw;
  if (typeof inner.seq !== "number" || !Number.isInteger(inner.seq)) {
    return null;
  }
  return {
    seq: inner.seq,
    kind: typeof inner.kind === "string" ? inner.kind : "message",
    body: typeof inner.body === "string" ? inner.body : "",
    id: typeof inner.id === "string" ? inner.id : undefined,
    room_id: typeof inner.room_id === "string" ? inner.room_id : undefined,
    sender_id: typeof inner.sender_id === "string" ? inner.sender_id : undefined,
    origin: typeof inner.origin === "string" ? inner.origin : undefined,
    created_at: typeof inner.created_at === "string" ? inner.created_at : undefined,
    client_message_id:
      typeof inner.client_message_id === "string" ? inner.client_message_id : undefined,
    thread_id:
      inner.thread_id === null || typeof inner.thread_id === "string" ? inner.thread_id : undefined,
    generation_id:
      inner.generation_id === null || typeof inner.generation_id === "string"
        ? inner.generation_id
        : undefined,
  };
}

export function parseWsPacket(text: string): WsPacket | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1 || typeof data.type !== "string") {
    return null;
  }
  if (data.type === "event") {
    const event = normalizeTimelineEvent(isRecord(data.event) ? data.event : null);
    if (!event) {
      return null;
    }
    return { type: "event", event };
  }
  if (data.type === "status") {
    return {
      type: "status",
      member_id: typeof data.member_id === "string" ? data.member_id : "",
      body: typeof data.body === "string" ? data.body : "",
    };
  }
  if (data.type === "error") {
    return {
      type: "error",
      code: typeof data.code === "string" ? data.code : "error",
      message: typeof data.message === "string" ? data.message : undefined,
    };
  }
  return null;
}
