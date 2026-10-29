# Providers

Personal subscription / free upstreams for **Layer A** (thinrouter).

## Active (implemented enough to use)

| ID | Aliases | Status | Format | Default base |
|----|---------|--------|--------|--------------|
| `siwc` | `chatgpt_siwc`, `openai_siwc` | **active, recommended** | OpenAI Responses (official plan sharing) | `https://api.openai.com/v1` |
| `claude` | `cc`, `anthropic`, `claude_code` | **active** (text, images, client tools via MCP) | local Claude Code CLI (`claude -p`), see [CLAUDE_SUBSCRIPTION.md](./CLAUDE_SUBSCRIPTION.md) | `local://claude-code` |
| `cursor` | `cu`, `cursor_agent` | **opt-in** (`--cursor-accept-account-plugins`; text only) | containerized Cursor Agent CLI (`cursor-agent -p`) | `local://cursor-agent` |
| `grok` | `xai`, `grok_cli` | **active** | OpenAI Responses | `https://cli-chat-proxy.grok.com/v1` |
| `opencode` | `oc` | **active** | OpenAI Chat | `https://opencode.ai/zen/v1` |
| `agy` | `ag`, `antigravity` | **active** | Antigravity generateContent | `https://cloudcode-pa.googleapis.com` |

**Status meaning**

- **active** — import tokens + forward with format conversion (chat ↔ responses / anthropic).
- **partial** — store OAuth/session tokens; full wire protocol is **not** built yet. Use when you need them as a *project* and we implement the executor.

### Streaming usage coverage

| Existing path | Raw observer | Authentication and retry accounting |
| --- | --- | --- |
| SIWC Responses (forced upstream stream) | `openai_responses_v1` for streaming Chat/Messages/Responses clients | OAuth proactive refresh and one legal401 refresh/retry; each actual inference send is a distinct attempt |
| Grok Responses (follows client stream) | `openai_responses_v1` for all three streaming clients | OAuth refresh or borrowed-file reread; borrowed credentials never refresh/write, and401 retries once only if the token changed |
| OpenCode Chat | `openai_chat_v1` for all three streaming clients | Existing token/free import; no new refresh or retry capability |
| Generic HTTP / Claude / Cursor | Existing Chat / Claude CLI / Cursor result observers | Prior delivery retained; Cursor remains text-only |
| Antigravity | Durable existing-HTTP attempts: buffered `antigravity_generate_content_v1`; opaque `antigravity_opaque_v1` with unknown semantic completion/usage | [AS-1–AS-5](tasks/T-0432-antigravity-settlement.md) reuse [T-0434 isolation](tasks/T-0434-antigravity-isolation.md); production refresh behavior unchanged |

For paths with the existing stream observer, refresh/discovery are not model inference. Retry/fallback attempts share a request ID while retaining separate results and clocks. Original upstream counters and terminal evidence are observed before conversion; missing values stay unknown, explicit zero survives, and a successful HTTP status alone is not completion. Observed SIWC/Grok/OpenCode streaming costs stay null without a verified billing basis. Pending attempts recover once as interrupted without replay. The [named HTTP acceptance and offline entry](tasks/T-0432-named-http-settlement.md) cover existing supported tools with synthetic endpoints; live client/version/provider behavior remains unverified. This does not restore the removed `codex` provider or expand buffered-client accounting.

Antigravity's [offline HTTP harness](ANTIGRAVITY-OFFLINE.md) provides the confinement foundation. The [existing-HTTP accounting continuation](tasks/T-0432-antigravity-settlement.md) reserves each actual inference, including legal401 retry and fallback; discovery/refresh alone do not create inference rows. Buffered original `usageMetadata` retains valid counts, missing/partial/invalid quality and explicit zero before client conversion. Only supported raw terminal evidence establishes succeeded/incomplete; converter-synthesized stop or zero is not evidence. Configured-rate buffered estimates retain their existing meaning, not verified subscription bills. Malformed HTTP200 conversion failure retains status200 with failed outcome and a fixed diagnostic. Streams still use `generateContent` and opaque passthrough for all three APIs: EOF means unknown, while observed cancel/stall/read failure retain their dispositions; token/cost/semantic first-output remain null. This adds no native Gemini stream conversion or tools/images. Production allowlist, endpoints and OAuth permissions remain unchanged.

### Buffered HTTP usage coverage

Generic API-key Chat, SIWC forced-SSE Responses, Grok JSON Responses and OpenCode Chat now use the same durable per-dispatch lifecycle for buffered Chat/Messages/Responses clients. Each fallback or existing legal401 retry has a distinct attempt under one request; refresh alone has no inference row. Original usage and terminal evidence are saved before conversion, independently of HTTP200 or client success. Failed collection, cancellation, timeout and finalization failure preserve their observed disposition; startup recovery never replays inference.

Direct JSON leaves `first_output_ms` unknown. SIWC measures it only from a meaningful delta observed on arrival, and uses the collector's first terminal snapshot without borrowing missing counters from earlier envelopes. Native Responses preserves accepted bytes, extensions and background status. Buffered configured-rate estimates retain the existing complete-counter/price requirement; named streaming costs remain unknown. These estimates do not establish subscription consumption. [BH-1–BH-5](tasks/T-0432-buffered-http-settlement.md) provides the isolated terminal entry, matrix and remaining boundaries; CLI buffered observation and real provider/client-version verification remain outside this slice.

### Import

Admin UI → Connections → **Import OAuth**, or:

```bash
curl -s http://127.0.0.1:20128/admin/api/connections/oauth/import \
  -H "x-admin-token: $(cat ~/.thinrouter/admin-token)" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-grok",
    "provider": "grok",
    "access_token": "…",
    "default_model": "grok-build"
  }'
```

List registry: `GET /admin/api/providers`

### siwc — Sign in with ChatGPT (the OpenAI route)

OpenAI's official plan sharing for open-source / local apps
([docs](https://developers.openai.com/siwc/token-sharing-open-source)): your ChatGPT plan
pays for `https://api.openai.com/v1/responses` calls made with a token issued to this app.
It is the only OpenAI route: the former `codex` provider (Codex CLI credentials on
ChatGPT's private `backend-api`, imitating the Codex client) was removed. Existing
`codex` connections are disabled and their tokens dropped when the database opens.

```bash
thinrouter login-siwc            # prints an auth.openai.com URL; open it on this machine
```

- Sign-in: dynamic client registration (`client_id=dynamic_agent_client`, app name
  `thinrouter`), PKCE S256, state + nonce, loopback `http://127.0.0.1:1455/auth/callback`,
  scope `... chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`. The issued
  `oaiapp_…` client id, the host id (`<data_dir>/siwc-host-id`, `urn:uuid:…`) and the
  account `sub` are kept in the connection meta; tokens are stored encrypted. Re-running
  reauthorizes with the saved client id and refuses a different account.
- The ID token's issuer, audience, nonce and expiry are checked; its signature is not
  (it comes straight from the token endpoint over TLS, OIDC Core 3.1.3.7).
- Refresh: `grant_type=refresh_token` with the issued client id and `resource`; refresh
  tokens rotate, so refreshes of one connection are serialized and the new pair is stored
  together.
- Requests: `store:false` and `stream:true` always; `background`, `conversation`,
  `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`,
  `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`,
  `top_p`, `truncation`, `user` are dropped; `role: system` items become `developer`;
  function/custom tools are grouped in one `namespace` tool (`client_tools`).
  `previous_response_id` and hosted tools (image generation, file search, code
  interpreter, computer use, MCP, `tool_search`) are rejected with 400 before any upstream
  call. `prompt_cache_key` + `session-id`/`thread-id` are sent (see below).
- `response.failed` with `subscription_sharing_usage_limit_exceeded` /
  `subscription_sharing_usage_unavailable` becomes HTTP 429 (non-stream) or an error
  record before `[DONE]` (stream).
- Not yet verified against a real account: the namespace tool shape and whether
  function calls inside it come back with plain names.

---

## Wishlist (record only — develop when needed)

| ID | Notes |
|----|--------|
| `github_copilot` | OAuth + copilot-token exchange |
| `kiro` | Free/subscription custom executor |
| `gemini_cli` | Google Gemini CLI OAuth |
| `qwen` | Qwen / DashScope |
| `iflow` | iFlow free tier |
| `vertex` | Vertex free credits |
| `glm` | Zhipu GLM cheap API |
| `minimax` | MiniMax cheap API |
| `deepseek` | DeepSeek API key |
| `openrouter` | OpenRouter multi-model |
| `ollama` | Local Ollama |
| `azure_openai` | Azure deployments |
| `bedrock` | AWS Bedrock |
| `perplexity` | Perplexity |
| `grok_web` | Grok web (non-CLI) |
| `codebuddy` | Tencent CodeBuddy |
| `qoder` | Qoder |
| `mimo_free` | MiMo free |
| `xiaomi_tokenplan` | Xiaomi token plan |

When you need one of these: open an item, implement `ProviderProfile` + forward quirks, move it from wishlist → active/partial.

---

## Forwarding notes

| Provider | Client → Upstream |
|----------|-------------------|
| siwc / grok | `/v1/responses` → forwarded natively (all items kept; siwc applies its preview limits above). `/v1/chat/completions` and `/v1/messages` → converted to a **Responses** body (tools, `tool_calls` ↔ `function_call`, tool results ↔ `function_call_output`, images ↔ `input_image`); the Responses SSE is converted back to `chat.completion.chunk` or Anthropic events (text and tool calls) |
| claude | Every client protocol → one prompt for the local `claude -p` (caller system in `<external_system_instructions>`); its stream events → client protocol |
| opencode | Chat Completions passthrough (+ `x-opencode-client`); `/v1/responses` clients get a full Responses event stream (message and `function_call` items, usage) converted from the chat chunks |
| cursor | Every client protocol → one text prompt (caller system in `<external_system_instructions>`) for `cursor-agent -p --output-format stream-json --stream-partial-output --mode ask --sandbox disabled --trust --workspace <empty dir>`; never `--force` / `--approve-mcps`. Only streaming deltas are used (duplicate flushes and `thinking` events skipped); usage comes from the `result` line (`inputTokens`, `outputTokens`, `cacheReadTokens`); output is converted to the client protocol. Tools and images → 501 (retryable). The prompt is a command-line argument: at most 128 KiB, and visible to other local users in `ps`. |
| agy | Antigravity `generateContent` envelope |

### siwc prompt cache

Every siwc request carries a `prompt_cache_key`: the client's own (Responses or Chat
Completions body field), otherwise a UUIDv5 of model + instructions + the first input
item, which stays the same across a conversation's turns. The same value goes out as
`session-id` and `thread-id` headers so the ChatGPT backend routes turns to the
machine holding the cached prefix. Two conversations that start identically share a
key; that only shares a cache prefix they already have in common.

### Token refresh

**grok imported by `import-local` is borrowed, never refreshed.** xAI refresh tokens
rotate: a refresh by thinrouter would invalidate the Grok CLI's stored token and log it
out. So `import-local` keeps no Grok refresh token and records `~/.grok/auth.json` as the
source; every upstream attempt re-reads the access token from that file. On a 401 it
re-reads once (the CLI may have refreshed) and otherwise returns 401 asking you to run
`grok`. `refresh`, refresh-all and the admin refresh endpoint skip or refuse it; the file
is only read, never written. agy (Google) refresh tokens do not rotate, so agy is
refreshed normally.

Automated for **siwc**, grok connections imported by hand with a refresh token, and **agy** when Google OAuth client env is set:

- On request: refresh if `expires_at` is within 5 minutes  
- On upstream **401**: one refresh + retry  
- CLI: `thinrouter refresh` or `thinrouter import-local --refresh`  
- API: `POST /admin/api/connections/{id}/refresh`, `POST /admin/api/connections/oauth/refresh-all`

**agy refresh env** (not stored in git — use Antigravity IDE / 9router public client):

```bash
export THINROUTER_AGY_CLIENT_ID='…'
export THINROUTER_AGY_CLIENT_SECRET='…'
```

**cursor and account plugins.** Probed with cursor-agent 2026.10.16 (2026-10-23): in
`-p --mode ask --sandbox enabled` the agent's tool catalog still lists the Cursor
account's plugins (Gmail, X) and they need no approval, and `cursor-agent plugin` only
manages marketplaces. A client prompt can therefore make the agent read plugin data, so
the provider refuses requests (503) unless the operator passes
`--cursor-accept-account-plugins`.

**cursor and MCP (for client tools, not built yet).** A workspace `.cursor/mcp.json`
server is "not loaded (needs approval)" without `--approve-mcps`; with it, the agent
first looks up the schema (`getMcpToolsToolCall`), then calls `mcpToolCall` with
`name: "<server>-<tool>"`, and the server receives a plain MCP `tools/call` with the
original tool name and waits for its answer — the same shape as the Claude Code bridge.
`--approve-mcps` approves every configured MCP server, not just one.

**cursor** needs no refresh: `cursor-agent` keeps its own login (`cursor-agent login`); thinrouter holds no Cursor token and stored ones are cleared on database open.

### Local import

```bash
thinrouter import-local            # --no-routes to skip rt-*, --refresh to refresh imported tokens
```

Reads:

| Provider | Path |
|----------|------|
| claude | nothing read: creates the connection when the `claude` CLI is installed |
| grok | `~/.grok/auth.json` |
| cursor | nothing read: creates the connection when the `cursor-agent` CLI is installed |
| opencode | free (no file) |
| agy | `~/.gemini/antigravity-cli/antigravity-oauth-token` |

Creates connections `local-*` and routes `rt-*`.

Cursor requires a pinned local Docker image and dedicated profile volume. Ask/sandbox flags are not isolation guarantees. See [Cursor isolation](cursor-isolation.md) for setup and filesystem/process boundaries; network access and account plugins remain available.
