# Providers

Personal subscription / free upstreams for **Layer A** (thinrouter).

## Active (implemented enough to use)

| ID | Aliases | Status | Format | Default base |
|----|---------|--------|--------|--------------|
| `siwc` | `chatgpt_siwc`, `openai_siwc` | **active, recommended** | OpenAI Responses (official plan sharing) | `https://api.openai.com/v1` |
| `claude` | `cc`, `anthropic`, `claude_code` | **active** (text, images, client tools via MCP) | local Claude Code CLI (`claude -p`), see [CLAUDE_SUBSCRIPTION.md](./CLAUDE_SUBSCRIPTION.md) | `local://claude-code` |
| `cursor` | `cu` | **active** | AgentService HTTP/2 Connect+proto (text) | `https://agent.api5.cursor.sh` |
| `grok` | `xai`, `grok_cli` | **active** | OpenAI Responses | `https://cli-chat-proxy.grok.com/v1` |
| `opencode` | `oc` | **active** | OpenAI Chat | `https://opencode.ai/zen/v1` |
| `agy` | `ag`, `antigravity` | **active** | Antigravity generateContent | `https://cloudcode-pa.googleapis.com` |

**Status meaning**

- **active** — import tokens + forward with format conversion (chat ↔ responses / anthropic).
- **partial** — store OAuth/session tokens; full wire protocol (Cursor protobuf, Antigravity Gemini envelope) is **not** built yet. Use when you need them as a *project* and we implement the executor.

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
| opencode | Chat Completions passthrough (+ `x-opencode-client`) |
| cursor / agy | Import only until executors land |

### siwc prompt cache

Every siwc request carries a `prompt_cache_key`: the client's own (Responses or Chat
Completions body field), otherwise a UUIDv5 of model + instructions + the first input
item, which stays the same across a conversation's turns. The same value goes out as
`session-id` and `thread-id` headers so the ChatGPT backend routes turns to the
machine holding the cached prefix. Two conversations that start identically share a
key; that only shares a cache prefix they already have in common.

### Token refresh

Automated for **siwc / grok**, and **agy** when Google OAuth client env is set:

- On request: refresh if `expires_at` is within 5 minutes  
- On upstream **401**: one refresh + retry  
- CLI: `thinrouter refresh` or `thinrouter import-local --refresh`  
- API: `POST /admin/api/connections/{id}/refresh`, `POST /admin/api/connections/oauth/refresh-all`

**agy refresh env** (not stored in git — use Antigravity IDE / 9router public client):

```bash
export THINROUTER_AGY_CLIENT_ID='…'
export THINROUTER_AGY_CLIENT_SECRET='…'
```

**cursor** refresh: `POST https://api2.cursor.sh/oauth/token`.  
**cursor** chat: AgentService `/agent.v1.AgentService/Run` over HTTP/2 (text-only; tools not supported).

### Local import

```bash
thinrouter import-local            # --no-routes to skip rt-*, --refresh to refresh imported tokens
```

Reads:

| Provider | Path |
|----------|------|
| claude | nothing read: creates the connection when the `claude` CLI is installed |
| grok | `~/.grok/auth.json` |
| cursor | `~/.config/cursor/auth.json` |
| opencode | free (no file) |
| agy | `~/.gemini/antigravity-cli/antigravity-oauth-token` |

Creates connections `local-*` and routes `rt-*`.
