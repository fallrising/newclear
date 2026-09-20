/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SESSIONS: KVNamespace;
    ROOM: DurableObjectNamespace;
    INBOX: DurableObjectNamespace;
    HOSTED: DurableObjectNamespace;
    ff_mcp: string;
    ff_hosted_agent: string;
    ff_sidecar: string;
    ff_ambient: string;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
