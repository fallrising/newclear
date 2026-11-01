# thinrouter

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。

> **先跑完整流程：** [離線演練](docs/OFFLINE-WALKTHROUGH.md)使用真正的 gateway 與本機假上游，一次跑過設定、三種 API、串流、工具、fallback、用量與重啟。`--serve` 可留下管理介面供操作，真實廠商接入留到最後。

> 當前收斂：[核心驗收對帳與剩餘工作入口](docs/tasks/T-0426-mainline-acceptance.md)（T-0426）。AC-03 本機驗證通過；真實旅程及既有用量修正仍待完成，主線未結案。

> 文件規劃：[LLM 用量正確性修正規格](../../docs/specs/llm-usage-correctness.md)（T-1102）。整理已確認缺陷、待重現問題與後續修正驗收；[D-06 錯誤保存切片](docs/tasks/T-0427-error-persistence.md) 已取得本機合成 RED→GREEN，[D-05 buffered 費用缺值切片](docs/tasks/T-0428-cost-completeness.md) 保留原始用量缺值，只有兩側 token 與價格明確有效才保存估算（含明確零）；[D-04 費用彙總切片](docs/tasks/T-0429-cost-coverage.md) 區分無資料、未知、部分小計及完整估算，附已知筆數覆蓋率。其餘 runtime 工作仍未完成。


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
> **`claude` provider** answers through your local, signed-in Claude Code CLI (interactive TUI by default; explicit print compatibility);
> thinrouter never holds or sends a Claude token, and your system prompt never replaces
> Claude Code's. Automated use of a subscription is still subject to Anthropic's terms —
> see [docs/CLAUDE_SUBSCRIPTION.md](./docs/CLAUDE_SUBSCRIPTION.md).

> [!WARNING]
> **`cursor` provider is off by default.** `cursor-agent` can use your Cursor account's
> plugins (for example Gmail) even in ask mode, and the CLI cannot turn them off,
> so any client holding a gateway key could make it read that data. Enable it only with
> `--cursor-accept-account-plugins` after disconnecting plugins you do not want exposed.
> A pinned local container image and dedicated profile volume are also required; see
> [Cursor isolation and setup](docs/cursor-isolation.md). Ask mode is not a security boundary.

## Process interruption and recovery evidence

The existing ledger now has a reproducible [M-10 crash-recovery check](docs/tasks/T-0432-crash-recovery.md): nine storage-process boundaries and three actual isolated buffered HTTP/fakeCLI gateway cases. Pending attempts recover once as interrupted/unknown usage; finalized history stays intact and restart sends no new request. The current runtime already passed, so this delivery adds tests and evidence without changing runtime policy. The retained private `local-demo.py` defaults to check and verifies source/binary pins; the task documents source-checkout commands and read-only report verification. This is offline evidence, not live client/provider acceptance.

## Cost aggregate compatibility

Admin stats and daily JSON expose `cost_summary` with `known_sum`, known/unknown/total row counts, nullable `coverage`, `status`, and `basis: "stored_estimate_usd"`. The legacy `estimated_cost_usd` aggregate is now null for empty, unknown or partial scopes; only a nonempty complete scope returns a number. A known zero remains zero. Web, TUI and `doctor` distinguish partial subtotals from complete estimates. Stats and the usage header are all-time; daily rows retain their existing bucket limits. Coverage measures non-null stored estimates, not billing accuracy. Event CSV values and stored rows are unchanged. See the [fixed acceptance and limits](docs/tasks/T-0429-cost-coverage.md).

## Quick start

Generic API-key Chat HTTP upstream streams reserve an attempt before dispatch and settle observed tail usage once for Chat, Messages and Responses clients. Converted streams account for original upstream usage, including tools, and settle before final output. Admin events expose `request_id`, `attempt_id`, `outcome`, `usage_status`, `usage_source`, `headers_ms`, `first_output_ms`, `total_observed_ms` and `finalized_at`; CSV appends these fields after the original columns. Daily `ok` means observed terminal success; use `headers_200` for the previous HTTP200 count. Historical rows and paths without a source observer retain unknown terminal provenance. A missing token remains unknown and cost is estimated only with complete observed counters and prices. Server startup recovers pending attempts as interrupted, without replay, and rejects a concurrent server sharing its data directory. See [three-client scope and acceptance](docs/tasks/T-0432-protocol-settlement.md) and the original [timing and compatibility](docs/tasks/T-0432-stream-settlement.md); #698 remains open for the other paths.

Existing SIWC and Grok Responses upstreams and OpenCode Chat upstreams now use durable streaming attempts for all three client protocols, including their supported tool exchanges. Each actual inference send has a separate attempt; fallback and the existing legal401 retry retain one request identity. OAuth refresh and model discovery do not create inference rows. Raw `openai_responses_v1` / `openai_chat_v1` observations preserve missing versus zero usage, HTTP status versus terminal outcome, and each attempt’s own timing. Named subscription/OAuth cost remains unknown, even with arbitrary configured rates. Borrowed Grok credentials remain read-only and are retried only when the existing reread detects a changed token. See [scope, isolation and acceptance](docs/tasks/T-0432-named-http-settlement.md).

Buffered clients now also reserve and settle each generic API-key, SIWC, Grok and OpenCode HTTP dispatch. Failed collection/conversion, cancellation and legal retries retain their own attempts and original usage; missing fields remain unknown. Direct JSON has no measured first-output timestamp. Native Responses bytes and accepted background responses remain unchanged. Existing buffered configured-rate estimates require complete counters and prices; they are not verified subscription bills. See [BH-1–BH-5 and evidence boundaries](docs/tasks/T-0432-buffered-http-settlement.md).

Claude Code and Cursor buffered Chat/Messages/Responses requests now use their existing raw CLI observers too. Each selected attempt is reserved before dispatch and settled once, including fallback, saved-session retry, collection failure and caller cancellation. Claude tools and live/saved session reuse retain their existing behavior; Cursor remains text-only. The ledger retains original source counters and clocks, independently of converted client usage. Cursor input/cache overlap is still unknown, so its normalized prompt and cost remain null. No buffered first-output or stall timeout is added. See [CB-1–CB-5 and the isolated fake-CLI check](docs/tasks/T-0432-buffered-cli-settlement.md).

For the buffered HTTP check, preserve the native test executable reported by `cargo +1.99.0 test --locked --bin thinrouter --no-run --message-format=json`, verify its source and test inventory, and record its SHA256 before running:

```sh
python3 scripts/buffered_http_check.py --test-binary /path/to/preserved-native-test --expected-test-sha256 <verified-sha256> --output-dir /path/to/buffered-http-evidence
```

This defaults to check mode, verifies confinement before HTTP and writes a report for 53 cases across nine stages, including SQL/JSON/CSV/Web reconciliation. It uses the real gateway router, controlled fake upstreams and test-only refresh transport. Reopening exercises production recovery under an owned store lock; it is not a full process-crash matrix or real client/provider acceptance.

For the headless named HTTP walkthrough after a locked build:

```sh
python3 scripts/named_http_walkthrough.py --check --binary "$CARGO_TARGET_DIR/debug/thinrouter" --expected-binary-sha256 <verified-sha256> --output-dir /path/to/named-http-evidence
```

The default check runs synthetic authentication, discovery, three-client streams and two-turn tools, fallback/borrowed401, failures/cancel/stall, consistent usage views and restart/reuse. `--serve` retains a disposable local admin demo until stopped. Every network destination is a controlled fake endpoint behind a non-forwarding proxy; refresh tests separately inject a test-only fake transport into the existing refresh logic. No real login, provider, client version or subscription billing is verified. Antigravity uses the separate isolation and accounting entries below; other buffered clients and Cursor tools/images are outside this named-HTTP continuation.

Antigravity has a separate [offline HTTP and settlement entry](docs/ANTIGRAVITY-OFFLINE.md). It uses a preserved native **test executable**, proves confinement before running the real gateway router, and writes a JSON report. Inference, project discovery and Google refresh all use a test-only non-forwarding loopback proxy; a production base override alone is insufficient. No login, desktop or real provider is involved. The [AS-1–AS-5 continuation](docs/tasks/T-0432-antigravity-settlement.md) adds durable inference accounting, buffered raw usage and explicit terminal evidence, failures/cancel/timeout and restart. Existing stream bytes remain opaque: EOF is unknown, with no native Gemini stream conversion or measured stream usage. The original [AI-1–AI-5](docs/tasks/T-0434-antigravity-isolation.md) evidence remains a historical isolation baseline.

Claude Code provider streams also reserve per dispatch across Chat, Messages and Responses, including live tool/user continuations and saved-session retries. Each attempt retains raw `reported_usage` input/output/cache counters; normalized `prompt_tokens` is known only when all disjoint input buckets are explicitly reported. Cumulative output replaces earlier counts. Missing fields stay unknown and CLI cost stays null. `cli_ready_ms` records the first accepted CLI event, separately from HTTP status and `headers_ms` (both null for CLI). First output excludes filtered thinking/tools/text. Successful CLI result/session totals are not attributed to a later request; an existing failing result still aborts the process and fails its active request without importing result counters. JSON/HTML/CSV expose the same stored observations; CSV appends five CLI columns after the existing fields. See [Claude scope, provenance and acceptance](docs/tasks/T-0432-claude-settlement.md). Actual CLI version/cache schema and real account/client behavior remain unverified.

For a terminal-only, isolated Claude walkthrough after a locked build:

```sh
python3 scripts/claude_walkthrough.py --check --binary "$CARGO_TARGET_DIR/debug/thinrouter" --output-dir /path/to/claude-evidence
```

This retained walkthrough explicitly tests print compatibility. The new synthetic `claude_tui_e2e` suite exercises the actual PTY/helper with a fake interactive child. Neither establishes real CLI compatibility or quota savings. The script defaults to check mode and accepts `--serve` for a disposable local demo. It runs a Python fake Claude plus the real gateway/MCP helper, verifies all three client streams/tools, fallback/failure/cancel/stall, usage and process/session reuse after restart, and preserves sanitized diagnostics plus source/binary hashes. It never invokes an installed Claude CLI or real provider. `--expected-binary-sha256` rejects a changed binary before launch; the delivered local helper also pins preserved script hashes. All reported tokens are synthetic fixture observations; all CLI costs remain unknown. The original generic HTTP walkthrough remains available.


Cursor text-only streams also retain per-dispatch raw `result.usage` counters with source `cursor_cli_result_v1`. `reported_usage` preserves input/output/cache values independently; absent fields stay unknown. Cursor's cache relationship is unverified, so normalized `prompt_tokens` and cost remain null, while observed output counts are retained. JSON/HTML/CSV use the same durable attempt, outcome and CLI timing. Existing opt-in, container isolation and tools/images refusal remain. Actual CLI version/account behavior is not established by the fake-runtime evidence. See [Cursor scope and acceptance](docs/tasks/T-0432-cursor-settlement.md).

For the isolated terminal walkthrough after a locked build:

```sh
python3 scripts/cursor_walkthrough.py --check --binary "$CARGO_TARGET_DIR/debug/thinrouter" --output-dir /path/to/cursor-evidence
```

This entry uses an absolute fake runtime and fake Cursor with the real gateway; it never invokes Docker or an installed Cursor CLI. It checks three-client text streaming, refusals/fallback, failure/cancel/post-output stall, usage and independent requests after restart. CLI costs remain unknown. `--serve` retains a disposable local demo until cleanup; `--expected-binary-sha256` rejects a changed executable. Before first output, a silent process can still wait until the caller cancels; this slice adds no startup timeout.


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
| `THINROUTER_CLAUDE_MODE` / `--claude-mode` | `tui` (default): genuine Unix PTY + incremental response observation; `print`: explicit legacy compatibility. No automatic print fallback. |
| `THINROUTER_CLAUDE_MAX_RUNS` / `--claude-max-runs` | Concurrent Claude Code processes (default 2) |
| `THINROUTER_CLAUDE_IDLE_SECS` / `--claude-idle-secs` | How long a completed Claude Code turn waits for client tool results or the next user turn (default 600) |
| `THINROUTER_CURSOR_BIN` / `--cursor-bin` | Cursor command inside the pinned image (default `cursor-agent`) |
| `THINROUTER_CURSOR_MAX_RUNS` / `--cursor-max-runs` | Concurrent Cursor Agent processes (default 2) |
| `THINROUTER_CURSOR_ACCEPT_ACCOUNT_PLUGINS` / `--cursor-accept-account-plugins` | Turn the cursor provider on, accepting that `cursor-agent` can use the account's Cursor plugins (default off) |
| `THINROUTER_SSE_STALL_SECS` / `--sse-stall-secs` | SSE idle timeout between chunks in seconds (default 90, minimum 5) |
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

Daily measurement coverage is available at `GET /admin/api/usage/daily?schema=2`. It distinguishes no events, unknown, partial, explicit zero and complete saved fields; token subtotals are not subscription consumption. HTTP headers, CLI ready, first output, total observed and legacy/compatibility latency have separate known-only means and coverage. The Web usage page uses the same canonical report for its latest14 populated dates; the API selects30. Default/schema1 retains legacy numeric scalars and a compatibility notice. CSV preserves missing fields as empty cells; TUI labels missing legacy latency as unknown. See the [bounded coverage contract and checks](docs/tasks/T-0435-measurement-coverage.md).

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
- Recognized final events in converted/native Responses streams release their upstream before final output, without waiting for provider EOF. Chat finish_reason alone still permits usage tails until [DONE]/EOF or the existing idle finalization. Observed EOF releases the source before generated completion/error output. Opaque passthrough keeps byte/EOF behavior; completed Claude sessions retain their reuse policy.
- Retained converter state has a16MiB payload allowance and4096collection entries per converter. Text/arguments use UTF-8 bytes; retained tool metadata uses serialized JSON size, and each output item or new map/set key consumes an entry. Exceeding either limit clears the failing converter and produces a fixed protocol error; a chain also ends when its final stage fails first. These are logical retained-state limits, not a total wire-traffic or RSS ceiling.
- Translated SSE input lines are limited to16MiB (field prefix and CR included, LF excluded). Oversized lines produce a fixed protocol error and release the source before final output, including after a Chat finish_reason-only record. Large chunks of bounded lines remain valid; a recognized terminal takes precedence over trailing bytes. This limits retained input lines, not total output/tool state or transport-owned chunks.
- SSE read-I/O failures use fixed diagnostics: converted streams and native Responses emit protocol errors, while opaque passthrough retains a redacted transport error. Known terminals are preserved, and owned source/error objects are released before final read-error output. This redacts generated transport diagnostics; already forwarded SSE payloads remain unchanged.
- Cooldown after 429 / auth / 5xx; SSE stall timeout. Translated streams and native Responses emit a fixed protocol error on an unfinished idle timeout; already parsed terminal outcomes are preserved. Opaque Chat/Messages passthrough keeps transport-error behavior. The upstream stream is released before the final timeout output. This is a per-chunk idle limit, not a total request deadline.
- Own schema (`~/.thinrouter`), not 9router.db compatible.

## License

MIT. Inspired by upstream MIT projects; not affiliated with 9Router.

Cursor container settings: `--cursor-image` / `THINROUTER_CURSOR_IMAGE` (pinned local digest), `--cursor-profile-volume` / `THINROUTER_CURSOR_PROFILE_VOLUME` (dedicated `thinrouter-cursor-*` named volume), and `--cursor-runtime-bin` / `THINROUTER_CURSOR_RUNTIME_BIN` (Docker executable, default `docker`). Missing settings return 503; there is no host CLI fallback.

Bounded fixture reliability checks: [fixture startup ownership and safe diagnostics](docs/tasks/T-0445-fixture-startup.md). Historical startup/auth causes remain unknown; test-only ownership evidence does not establish real-provider acceptance.
