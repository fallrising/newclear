/** v2 hosted LLM adapter contract (docs/v2/03-agent-runtime.md §2.3). */
export type ApiFormat = "openai_chat" | "openai_responses" | "anthropic_messages" | "gemini" | "fake";
export const API_FORMATS: readonly ApiFormat[] = ["openai_chat", "openai_responses", "anthropic_messages", "gemini", "fake"];
/** Formats a W4 adapter exists for. The others are accepted by the DDL but refused by the API until W5. */
export const W4_FORMATS: readonly ApiFormat[] = ["openai_chat", "anthropic_messages"];

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ResolvedConnection = {
  id: string;
  api_format: ApiFormat;
  base_url: string; // normalized, no trailing slash
  secret: string; // "" when secret_source = none
  extra_headers: Record<string, string>;
  token_param: "max_tokens" | "max_completion_tokens";
};

export type NormalizedRequest = {
  model: string;
  system: string;
  transcript: string;
  max_output_tokens: number;
  temperature?: number;
  stop?: string[];
  stream: boolean;
};

export type NormalizedResult = {
  text: string;
  finish: "stop" | "length" | "content_filter" | "other";
  usage?: { input_tokens?: number; output_tokens?: number };
};

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

export class LlmError extends Error {
  readonly errorClass: LlmErrorClass;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(errorClass: LlmErrorClass, status?: number, retryAfterMs?: number) {
    // Never carries upstream text (FM-LLM-03, RT-09).
    super(`llm ${errorClass}${status === undefined ? "" : ` ${status}`}`);
    this.name = "LlmError";
    this.errorClass = errorClass;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface LlmAdapter {
  readonly format: ApiFormat;
  listModels(conn: ResolvedConnection, fetchImpl: FetchLike, signal?: AbortSignal): Promise<string[]>;
  complete(
    conn: ResolvedConnection,
    req: NormalizedRequest,
    fetchImpl: FetchLike,
    signal?: AbortSignal,
  ): Promise<NormalizedResult>;
}
