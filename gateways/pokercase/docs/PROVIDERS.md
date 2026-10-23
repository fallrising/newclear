# Providers

Personal subscription / free upstreams for **Layer A** (thinrouter).

## Active (implemented enough to use)

| ID | Aliases | Status | Format | Default base |
|----|---------|--------|--------|--------------|
| `codex` | `cx` | **active** | OpenAI Responses | `https://chatgpt.com/backend-api/codex/responses` |
| `claude` | `cc`, `anthropic` | **active** | Anthropic Messages | `https://api.anthropic.com/v1/messages` （订阅原理见 [CLAUDE_SUBSCRIPTION.md](./CLAUDE_SUBSCRIPTION.md)） |
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
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-codex",
    "provider": "codex",
    "access_token": "…",
    "default_model": "gpt-5.3-codex"
  }'
```

List registry: `GET /admin/api/providers`

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
| codex / grok | `/v1/responses` → forwarded natively (all items kept; Codex: `store:false`, `stream:true`, sampling fields dropped). `/v1/chat/completions` and `/v1/messages` → converted to a **Responses** body (tools, `tool_calls` ↔ `function_call`, tool results ↔ `function_call_output`, images ↔ `input_image`); the Responses SSE is converted back to `chat.completion.chunk` or Anthropic events (text and tool calls) |
| claude | Chat Completions → **Anthropic Messages**; native `/v1/messages` passes through |
| opencode | Chat Completions passthrough (+ `x-opencode-client`) |
| cursor / agy | Import only until executors land |

### Codex prompt cache

Every Codex request carries a `prompt_cache_key`: the client's own (Responses or Chat
Completions body field), otherwise a UUIDv5 of model + instructions + the first input
item, which stays the same across a conversation's turns. The same value goes out as
`session-id` and `thread-id` headers so the ChatGPT backend routes turns to the
machine holding the cached prefix. Two conversations that start identically share a
key; that only shares a cache prefix they already have in common. The User-Agent is
`codex_cli_rs/<version>` with the version from `--codex-version`, the installed
`codex --version`, or the fallback (logged at startup).

### Token refresh

Automated for **codex / claude / grok**, and **agy** when Google OAuth client env is set:

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
thinrouter import-local --routes --refresh
```

Reads:

| Provider | Path |
|----------|------|
| codex | `~/.codex/auth.json` (+ model from `config.toml`) |
| claude | `~/.claude/.credentials.json` |
| grok | `~/.grok/auth.json` |
| cursor | `~/.config/cursor/auth.json` |
| opencode | free (no file) |
| agy | `~/.gemini/antigravity-cli/antigravity-oauth-token` |

Creates connections `local-*` and routes `rt-*`.
