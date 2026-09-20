/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    HOSTED: DurableObjectNamespace;
    XAI_API_KEY?: string;
    FAKE_LLM_TEXT?: string;
    FAKE_LLM_MODELS?: string;
  }
}
