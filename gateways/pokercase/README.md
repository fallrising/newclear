# thinrouter

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: C (dormant)** — Preserved; not an active investment. **Dormant since:** 2026-09-04. Restore only with an explicit owner decision in [PORTFOLIO.md](../../PORTFOLIO.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md).


A **thin** OpenAI-compatible LLM API proxy in Rust, inspired by [9router](https://github.com/decolua/9router) / [9router-go](https://github.com/luqman-v1/9router-go).

| | |
|--|--|
| **GitHub repo** | [fallrising/pokercase](https://github.com/fallrising/pokercase) |
| **Crate / binary name** | `thinrouter` |
| **Goals & progress** | [docs/GOALS_AND_PROGRESS.md](./docs/GOALS_AND_PROGRESS.md) |
| **Client setup** | [docs/CLIENTS.md](./docs/CLIENTS.md) |

> **Naming:** the GitHub repository is **pokercase**; the product binary and local data dir are **thinrouter** (`~/.thinrouter`). This is intentional documentation, not a rename of either side.

**In scope:** `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, routes + fallback/RR, **OAuth/session token import** (personal subscriptions), optional token-saver, web admin, TUI, SQLite.

**Architecture:** Layer A = this gateway; Layer B = your multi-agent “team” apps calling only Layer A. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).  
**Providers:** siwc (OpenAI models) · claude · cursor · grok · opencode · agy — [docs/PROVIDERS.md](./docs/PROVIDERS.md)  
**Claude 订阅原理：** [docs/CLAUDE_SUBSCRIPTION.md](./docs/CLAUDE_SUBSCRIPTION.md)

**Out of scope (for now):** MITM, cloud sync, 9router.db compatibility, media APIs.

> [!WARNING]
> **`claude` provider** answers through your local, signed-in Claude Code CLI (`claude -p`);
> thinrouter never holds or sends a Claude token, and your system prompt never replaces
> Claude Code's. Automated use of a subscription is still subject to Anthropic's terms —
> see [docs/CLAUDE_SUBSCRIPTION.md](./docs/CLAUDE_SUBSCRIPTION.md).

> [!WARNING]
> **`cursor` provider is off by default.** `cursor-agent` can use your Cursor account's
> plugins (for example Gmail) even in read-only ask mode, and the CLI cannot turn them off,
> so any client holding a gateway key could make it read that data. Enable it only with
> `--cursor-accept-account-plugins` after disconnecting plugins you do not want exposed.

## Quick start

```bash
cargo run -- serve
# admin:  http://127.0.0.1:20128/admin   (token: cat ~/.thinrouter/admin-token)
# proxy:  http://127.0.0.1:20128/v1
# claude:    http://127.0.0.1:20128/v1/messages
# responses: http://127.0.0.1:20128/v1/responses
# data:      ~/.thinrouter/thinrouter.db (secrets encrypted with ~/.thinrouter/secrets.key)
```

1. Log in at `/admin/login` with the admin token. Without `--admin-token`, the first
   start writes a random one to `~/.thinrouter/admin-token` (mode 0600); the log shows
   only the path.
2. For OpenAI models, run `thinrouter login-siwc` (official Sign in with ChatGPT plan sharing; creates connection `siwc` + route `rt-siwc`). Otherwise open **Connections** → either:
   - **Import OAuth / session token** (personal subscription; no API key), or  
   - Add OpenAI-compatible `base_url` + API key (optional path).
3. Open **Routes** → map a public model name to one or more targets.
4. Create a **gateway API Key**. Inference and model-list endpoints require an enabled key by default, including when no keys exist or every key is disabled.
5. Point clients at the proxy (see [docs/CLIENTS.md](./docs/CLIENTS.md)).

```bash
curl -s http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cheap",
    "messages": [{"role":"user","content":"hi"}],
    "stream": false
  }'
```

Model resolution:

| Client `model` | Behavior |
|----------------|----------|
| `route-name` | Named route targets (`fallback` or `round_robin`) |
| `connection/model` | Direct to that connection + upstream model |
| `connection` | Connection’s `default_model` |

## CLI

```bash
thinrouter serve --host 127.0.0.1 --port 20128
thinrouter serve --data-dir ./data --admin-token secret --secrets-key passphrase
thinrouter doctor
thinrouter tui
# Import personal subscription tokens from local agent CLIs (creates rt-* routes;
# add --refresh to refresh imported tokens, --no-routes to skip routes):
thinrouter import-local
thinrouter refresh
# Official ChatGPT plan sharing (browser sign-in, loopback 127.0.0.1:1455):
thinrouter login-siwc [--name siwc] [--model <slug>]
```

| Flag / env | Purpose |
|------------|---------|
| `THINROUTER_HOST` / `--host` | Bind host |
| `THINROUTER_PORT` / `--port` | Bind port |
| `THINROUTER_DATA_DIR` / `--data-dir` | SQLite directory |
| `THINROUTER_ADMIN_TOKEN` / `--admin-token` | Admin token (login UI + `x-admin-token`); default: generated `<data_dir>/admin-token` |
| `THINROUTER_ALLOWED_HOSTS` / `--allowed-host` | Extra `Host` names (e.g. Tailscale Serve name); IP literals and `localhost` always pass |
| `THINROUTER_ALLOW_KEYLESS_BOOTSTRAP` / `--allow-keyless-bootstrap` | Explicit local bootstrap; default off, exact loopback listener, direct (non-forwarded) requests and zero total keys only |
| `THINROUTER_SECRETS_KEY` / `--secrets-key` | Passphrase (Argon2id) for at-rest encryption; default: random `<data_dir>/secrets.key` |
| `THINROUTER_PROVIDER_BASE_OVERRIDES` / `--provider-base-override` | Operator-only `provider=url` upstream base (mocks, egress proxies) |
| `THINROUTER_CLAUDE_BIN` / `--claude-bin` | Claude Code CLI for the `claude` provider (default `claude` on PATH) |
| `THINROUTER_CLAUDE_MAX_RUNS` / `--claude-max-runs` | Concurrent Claude Code processes (default 2) |
| `THINROUTER_CLAUDE_IDLE_SECS` / `--claude-idle-secs` | How long a Claude Code run waits for the client's tool results (default 600) |
| `THINROUTER_CURSOR_BIN` / `--cursor-bin` | Cursor Agent CLI for the `cursor` provider (default `cursor-agent` on PATH) |
| `THINROUTER_CURSOR_MAX_RUNS` / `--cursor-max-runs` | Concurrent Cursor Agent processes (default 2) |
| `THINROUTER_CURSOR_ACCEPT_ACCOUNT_PLUGINS` / `--cursor-accept-account-plugins` | Turn the cursor provider on, accepting that `cursor-agent` can use the account's Cursor plugins (default off) |
| `THINROUTER_SSE_STALL_SECS` / `--sse-stall-secs` | Abort SSE if no chunk (default 90) |
| `THINROUTER_TOKEN_SAVER` / `--token-saver` | Truncate tool / huge message content |
| `THINROUTER_TOKEN_SAVER_MAX_CHARS` | Max chars kept per tool-like block (default 2000) |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | Upstream egress proxy |

For temporary keyless local setup, run `thinrouter serve --host 127.0.0.1 --allow-keyless-bootstrap` and omit both API credential headers. Creating a key closes bootstrap; disabled keys still count as configured. Invalid credentials always fail. Remove the flag to restore the default. Clients that require a credential should use a gateway key.

The admin UI/API always requires the admin token. Non-loopback listeners require an explicit nonempty `--admin-token` and cannot enable keyless bootstrap; requests through Tailscale Serve, cloudflared or any proxy header are remote and never get bootstrap. Use an admin session to create gateway keys before sending inference requests. Disabling all gateway keys stops subsequent inference admissions; already-issued provider calls can still consume resources. See [cost safety](docs/cost-safety.md) for the contract and remaining provider budget controls.

## Admin JSON API

Same operations as the UI under `/admin/api/*` (`x-admin-token`, or a login session cookie plus `x-csrf-token` for writes):

- `GET/POST /admin/api/connections` · `PUT/DELETE .../{id}` · `POST .../{id}/test`
- `POST /admin/api/connections/oauth/import` — personal subscription tokens
- `GET/POST /admin/api/routes` · `GET/PUT/DELETE .../{id}`
- `GET/POST /admin/api/keys` · `DELETE .../{id}`
- `GET /admin/api/usage` · `.../daily` · `.../export.csv` · `GET /admin/api/stats`

Multi-target route:

```bash
curl -s http://127.0.0.1:20128/admin/api/routes \
  -H "x-admin-token: $(cat ~/.thinrouter/admin-token)" \
  -H 'Content-Type: application/json' \
  -d '{
    "public_model": "cheap",
    "strategy": "fallback",
    "targets": [
      {"connection_id": "UUID1", "model_override": "gpt-4o-mini"},
      {"connection_id": "UUID2", "model_override": null}
    ]
  }'
```

## Remote access (Tailscale Serve)

Keep the listener on loopback and let Tailscale terminate HTTPS inside your tailnet:

```bash
thinrouter serve --allowed-host mybox.tailnet-name.ts.net
tailscale serve --bg 20128
```

- Admin: `https://mybox.tailnet-name.ts.net/admin`, log in with `~/.thinrouter/admin-token`.
- Clients: create a gateway key; send `Authorization: Bearer <key>`. Do not use `--allow-keyless-bootstrap` while any forwarder points at the port.
- Do not expose this port with `tailscale funnel`.

Admin token, CSRF/Host checks, upstream allowlist and at-rest encryption: [docs/security.md](docs/security.md).

## Docker

```bash
docker compose up --build -d
# http://127.0.0.1:20128/admin
```

Set `THINROUTER_ADMIN_TOKEN` through your environment or secret configuration before starting Compose. The container binds a non-loopback address and requires that token; Compose publishes the port on host loopback by default. Log in to the admin UI, then create and supply a gateway API key.

## Design notes

- Single process: proxy + web UI + SQLite (+ optional TUI).
- Hot path: API key auth → resolve model → ordered fallback / RR **before** SSE headers committed → byte passthrough (or Anthropic translate).
- Cooldown after 429 / auth / 5xx; SSE stall timeout.
- Own schema (`~/.thinrouter`), not 9router.db compatible.

## License

MIT. Inspired by upstream MIT projects; not affiliated with 9Router.
