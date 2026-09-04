# Client wiring for 9router (LLM gateway)

9router exposes an OpenAI-compatible API at `http://127.0.0.1:20128/v1`.

Do not confuse:

| Name | Role |
|------|------|
| **OpenCode CLI** | Client tool — point its provider base URL at 9router `/v1` |
| **OpenCode Free** | A free *upstream provider inside* 9router (passthrough to opencode.ai) |

## First-time 9router setup

1. `docker compose up -d nine_router`
2. Open `http://127.0.0.1:20128/dashboard`
3. Set dashboard password / copy the gateway API key
4. Connect providers (OpenRouter, Anthropic, OpenAI, OpenCode Free, …)
5. Wire Pi / OpenCode using the templates in this folder

Compliance note: subscription and free-tier channels must follow each provider's terms; this stack does not bypass ToS.
