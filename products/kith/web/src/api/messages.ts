import { apiFetch } from "./client";
import type { Me, MessagesPage, ServerMessage } from "./types";

// Promise-based calls for RoomSync (not hooks). Every read asks for message and trace rows so gap
// detection works on the room-wide seq (FE-12).

const KINDS = "message,trace";

function base(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/messages`;
}

export function fetchLatest(roomId: string, signal: AbortSignal): Promise<MessagesPage> {
  return apiFetch<MessagesPage>(`${base(roomId)}?order=desc&limit=50&kind=${KINDS}`, { signal });
}

export function fetchOlder(roomId: string, beforeSeq: number, signal: AbortSignal): Promise<MessagesPage> {
  return apiFetch<MessagesPage>(`${base(roomId)}?order=desc&before_seq=${beforeSeq}&limit=50&kind=${KINDS}`, { signal });
}

export function fetchAfter(roomId: string, afterSeq: number, signal: AbortSignal): Promise<MessagesPage> {
  return apiFetch<MessagesPage>(`${base(roomId)}?order=asc&after_seq=${afterSeq}&limit=50&kind=${KINDS}`, { signal });
}

export function postMessage(roomId: string, body: string, clientMessageId: string, signal: AbortSignal): Promise<ServerMessage> {
  return apiFetch<ServerMessage>(base(roomId), { method: "POST", body: { body, client_message_id: clientMessageId }, signal });
}

/** Only used to tell a lost session (401) apart from other WS upgrade failures. */
export async function probeMe(signal: AbortSignal): Promise<void> {
  await apiFetch<Me>("/api/me", { signal });
}
