export type QuotaClass = "api_key" | "operator_personal";
export type RuntimeKind = "hosted" | "runner" | "external";
export type RuntimeStatus = "ok" | "unconfigured" | "connection_error" | "runner_offline" | "disabled";
export type ApiFormat = "openai_chat" | "anthropic_messages" | "openai_responses" | "gemini";
export type AdapterKind = "codex" | "claude_code" | "gemini_cli" | "command";
export type ProviderPreset = "openai" | "anthropic" | "google" | "xai" | "deepseek" | "openrouter" | "mistral" | "groq" | "custom";
export type LlmErrorClass =
  | "auth"
  | "not_found"
  | "bad_request"
  | "context_length"
  | "rate_limited"
  | "overloaded"
  | "content_filter"
  | "timeout"
  | "network"
  | "protocol"
  | "unknown";
export type AgentRuntimeSummary = {
  runtime: RuntimeKind | null;
  runtime_status: RuntimeStatus;
  runtime_epoch: number;
  connection_id: string | null;
  connection_name: string | null;
  api_format: string | null;
  model: string | null;
  adapter_kind: AdapterKind | null;
  runner_last_seen_at: string | null;
};
export type AttentionMode = "silent" | "mention" | "keyword" | "ambient";
export type ReplyLimit = { code: "fixed"; fixed_text: string } | { code: "sidecar_off" } | null;
export type AttentionUpdate = { mode?: AttentionMode; keywords?: string[]; cooldown_ms?: number; debounce_ms?: number };

/** GET /api/me 與 POST /api/auth/login 的 member（worker/index.ts publicMember）。 */
export type Me = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  capabilities_json: string;
  quota_class: QuotaClass;
  is_operator: 0 | 1;
  must_change_password: boolean;
  operator_display_name?: string | null; // 只有 GET /api/me 有；login 回應沒有
};

export type LoginRequest = { handle: string; password: string };
export type LoginResponse = { ok: true; member: Me };
export type LogoutResponse = { ok: true };
export type CsrfResponse = { csrf: string };
export type ApiErrorBody = { error: { code: string; message: string } };

export type LastMessage = {
  seq: number;
  sender_id: string;
  sender_display_name: string | null;
  sender_handle: string | null;
  body_preview: string;
  created_at: string;
};
export type RoomSummary = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  role: "owner" | "member" | null; // all=1 且 operator 不是成員時為 null
  archived_at: string | null;
  last_seq: number | null;
  member_count: number;
  last_message: LastMessage | null;
};
export type RoomsResponse = { rooms: RoomSummary[] };

export type AdminMember = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  is_operator: 0 | 1;
  quota_class: QuotaClass;
  created_at: string;
  disabled_at: string | null;
  must_change_password: boolean;
};

export type RoomMember = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  quota_class: QuotaClass;
  is_operator: 0 | 1;
  role: "owner" | "member";
  attention_mode: AttentionMode;
  keywords_json: string;
  policy_epoch: number;
  operator_only: boolean;
  reply_limit: ReplyLimit;
  agent_runtime?: AgentRuntimeSummary | null;
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
  | { v: 1; type: "status"; member_id: string; body: string; error_class?: string }
  | { v: 1; type: "error"; code: string }
  | { v: 1; type: "draft"; member_id: string; generation_id: string; text: string; done: false };

export type Provider = {
  id: string;
  name: string;
  preset: ProviderPreset;
  api_format: string;
  base_url: string;
  secret_source: "stored" | "env" | "none";
  secret_env: string | null;
  secret_last4: string | null;
  secret_updated_at: string | null;
  extra_headers: Record<string, string>;
  default_quota_class: QuotaClass;
  token_param: "max_tokens" | "max_completion_tokens";
  last_error_class: LlmErrorClass | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
  agent_count: number;
};
export type ProviderTestResult = { ok: true; models: string[] | null } | { ok: false; error_class: LlmErrorClass };
export type ProviderDraft = {
  preset: ProviderPreset;
  api_format?: ApiFormat;
  base_url?: string;
  secret_source: "stored" | "env" | "none";
  secret?: string;
  secret_env?: string;
  extra_headers?: Record<string, string>;
  token_param?: Provider["token_param"];
};
export type AdminAgent = AgentRuntimeSummary & {
  id: string;
  handle: string;
  display_name: string;
  quota_class: QuotaClass;
  created_at: string | null;
  disabled_at: string | null;
  rooms: string[];
  token_count: number;
};
export type RuntimeChange = {
  id: string;
  from_runtime: RuntimeKind | null;
  to_runtime: RuntimeKind;
  from_epoch: number | null;
  to_epoch: number;
  created_at: string;
  changed_by: string;
  changed_by_name: string;
};
export type Generation = {
  id: string;
  room_id: string;
  room_name: string | null;
  trigger_seq: number;
  state: "queued" | "dispatched" | "streaming" | "completed" | "dropped" | "failed";
  error_class: LlmErrorClass | null;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  connection_id: string | null;
  model: string | null;
  runtime_epoch: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};
export type AgentDetail = AdminAgent & {
  max_output_tokens: number;
  temperature: number | null;
  stream: boolean;
  system_prompt_addendum: string;
  runtime_changes: RuntimeChange[];
};
export type PutRuntimeBody =
  | {
      runtime: "hosted";
      quota_class: QuotaClass;
      connection_id: string;
      model: string;
      system_prompt_addendum?: string;
      max_output_tokens?: number;
      temperature?: number | null;
      stream?: boolean;
      revoke_tokens?: boolean;
    }
  | { runtime: "runner"; quota_class: QuotaClass; adapter_kind: AdapterKind; revoke_tokens?: boolean }
  | { runtime: "external"; quota_class: QuotaClass; revoke_tokens?: boolean };
export type BotToken = {
  id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  room_scope_json: string;
};
