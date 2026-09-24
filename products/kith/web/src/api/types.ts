export type QuotaClass = "api_key" | "operator_personal";

/** GET /api/me 與 POST /api/auth/login 的 member（worker/index.ts publicMember）。 */
export type Me = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  capabilities_json: string;
  quota_class: QuotaClass;
  is_operator: 0 | 1;
};

export type LoginRequest = { handle: string; password: string };
export type LoginResponse = { ok: true; member: Me };
export type LogoutResponse = { ok: true };
export type CsrfResponse = { csrf: string };
export type ApiErrorBody = { error: { code: string; message: string } };

export type Room = { id: string; slug: string; name: string; created_at: string; role: "owner" | "member" };
export type RoomsResponse = { rooms: Room[] };

export type RoomMember = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  quota_class: QuotaClass;
  is_operator: 0 | 1;
  role: "owner" | "member";
  attention_mode: "silent" | "mention" | "keyword" | "ambient";
  keywords_json: string;
  policy_epoch: number;
  operator_only: boolean;
  reply_limit: unknown; // W3 定型；W1 不讀
};
export type RoomMembersResponse = { members: RoomMember[] };

/** REST 列與 WS event 的共同欄位。WS event 沒有 mentions_json 與 reply_to。 */
export type ServerMessage = {
  id: string;
  room_id: string;
  seq: number;
  kind: "message" | "trace";
  thread_id: string | null;
  reply_to?: string | null;
  sender_id: string;
  body: string;
  mentions_json?: string;
  generation_id: string | null;
  client_message_id: string;
  origin: "local";
  created_at: string;
};
export type MessagesPage = { messages: ServerMessage[]; has_more: boolean };

export type WsServerFrame =
  | { v: 1; type: "event"; event: ServerMessage }
  | { v: 1; type: "status"; member_id: string; body: string }
  | { v: 1; type: "error"; code: string };
