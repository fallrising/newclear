import { anthropicMessages } from "./anthropic-messages.ts";
import { openaiChat } from "./openai-chat.ts";
import type { ApiFormat, LlmAdapter } from "./types.ts";

/** RT-03: a new format = a new file + one line here. HostedGeneration never switches on format. */
const ADAPTERS: Partial<Record<ApiFormat, LlmAdapter>> = {
  openai_chat: openaiChat,
  anthropic_messages: anthropicMessages,
};

export function adapterFor(format: ApiFormat): LlmAdapter | null {
  return ADAPTERS[format] ?? null;
}
