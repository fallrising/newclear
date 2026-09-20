export type MemberKind = "human" | "agent" | string;

export type QuotaClass = "api_key" | "operator_personal" | string;

export type Room = {
  id: string;
  name?: string;
  slug?: string;
};

export type Member = {
  id: string;
  handle?: string;
  display_name?: string;
  kind?: MemberKind;
  quota_class?: QuotaClass;
  attention_mode?: string;
  operator_only?: boolean;
};

export type TimelineEvent = {
  seq: number;
  kind: string;
  body: string;
  id?: string;
  room_id?: string;
  sender_id?: string;
  origin?: string;
  created_at?: string;
  client_message_id?: string;
  thread_id?: string | null;
  generation_id?: string | null;
};

export type WsPacket =
  | { type: "event"; event: TimelineEvent }
  | { type: "status"; member_id: string; body: string }
  | { type: "error"; code: string; message?: string };
