// Typed wrappers + event types for the AI bridge IPC. Lives next to
// doc_ipc so the document surface (the only AI consumer today) can pull
// from a single spot.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AiStatus {
  /// Active provider — "anthropic", "openai", or "deepseek".
  provider: string;
  /// Model id (provider default if LOOM_AI_MODEL is unset).
  model: string;
  /// True when the active provider's API key env var is populated.
  key_present: boolean;
  /// Name of the env var that holds the key. Surfaces in the empty-
  /// state message so the user sees the right variable.
  key_env: string;
}

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type AiEvent =
  | { kind: "started"; request_id: string }
  | { kind: "text"; request_id: string; delta: string }
  | { kind: "done"; request_id: string; usage: AiUsage }
  | { kind: "error"; request_id: string; message: string }
  | { kind: "cancelled"; request_id: string };

export async function aiStatus(): Promise<AiStatus> {
  return invoke<AiStatus>("ai_status");
}

export interface PinnedContext {
  source: string;
  content: string;
}

export async function aiAsk(
  prompt: string,
  contextDoc: string | null,
  pinnedContext: PinnedContext[] = [],
): Promise<string> {
  return invoke<string>("ai_ask", { prompt, contextDoc, pinnedContext });
}

export async function aiCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("ai_cancel", { requestId });
}

export function onAiEvent(
  handler: (event: AiEvent) => void,
): Promise<UnlistenFn> {
  return listen<AiEvent>("ai:event", (e) => handler(e.payload));
}
