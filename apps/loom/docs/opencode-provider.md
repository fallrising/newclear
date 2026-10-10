# OpenCode Go provider integration

Status: implementation specification, 2026-10-04. Existing Loom providers hard-code vendor URLs; the user's OpenCode Go key needs gateway configuration and protocol selection. This slice adds those without changing frozen contracts or adding dependencies.

## Configuration and behavior

`LOOM_AI_PROVIDER=opencode` identifies the gateway and reads `OPENCODE_API_KEY`. Its default base URL is `https://opencode.ai/zen/go/v1`. `LOOM_AI_BASE_URL` may override a provider base URL (including Zen); it includes any `/v1` prefix but not the final operation. `LOOM_AI_PROTOCOL` explicitly selects `chat-completions`, `responses`, or `messages`. OpenCode requires both this protocol and a nonempty `LOOM_AI_MODEL`: no model-name guessing or silent fallback to Anthropic. Existing Anthropic/OpenAI/DeepSeek defaults stay compatible when no overrides are supplied. Unknown or empty explicitly set configuration fails visibly before making a request.

`LOOM_AI_API_KEY_ENV` optionally selects a different environment-variable name, never the key value. Its name must be a conventional nonempty environment identifier. `LOOM_AI_MAX_TOKENS` retains a positive integer output budget; invalid explicit values fail configuration. Resolve settings through a pure, testable reader so tests do not race process-global environment. Status and calls use the same validation; the status DTO may add nonfrozen `protocol`, `base_url`, `configuration_error` fields. Invalid status must disable sending with an actionable message. Status never contains credentials.

Base URLs allow HTTPS, or HTTP only for loopback testing/local gateways. Reject embedded credentials, query strings, fragments, missing hosts, non-HTTP schemes and already-appended operation paths. Normalize trailing slashes. Reject invalid inputs without echoing potentially secret URL/user input. Disable HTTP redirects so custom authentication headers cannot follow a new destination. Do not log request headers or key-bearing configuration; redact the selected key from returned provider errors.

Go requests identify Loom with `User-Agent: loom/0.1.0` and `x-opencode-session`: an opaque stable ID for the desktop AI service lifetime, reused across requests and never derived from file paths or key material. This is not a claim of remote conversation persistence. All three protocols receive these headers for the OpenCode provider. No provider account/credit settings are changed.

## Wire protocols

The internal `Provider`/`StreamEvent` interface stays authoritative for the runtime. Select a protocol explicitly and route its prepared request to the configured base plus `/chat/completions`, `/responses`, or `/messages`. Do not send a second request or switch protocols automatically after an error.

- Chat Completions and Messages retain their existing request/context/stream behavior and native auth conventions (Bearer and x-api-key respectively).
- Responses uses model, instructions, input, max_output_tokens and stream; no chat-only messages/max_tokens/stream_options. Preserve active-document and pinned-document context. `response.output_text.delta` emits user-visible text; refusal deltas also remain visible. `response.completed` yields final usage once and terminates without waiting for HTTP EOF. Failed/incomplete/error events are errors, not successful completion. Do not duplicate completed aggregate text or include reasoning/tool metadata in document output.
- All adapters must preserve cancellation, split Unicode/SSE handling, malformed-payload errors and EOF-before-terminal errors. Usage normalizes to existing fields without double counting.

Sources checked 2026-10-04: [OpenCode Go endpoints and client headers](https://opencode.ai/docs/go/#endpoints), [Go client guidance](https://opencode.ai/docs/go/#where-can-i-use-it), [Zen endpoints](https://opencode.ai/docs/en/zen/#endpoints), [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [Responses events](https://platform.openai.com/docs/api-reference/responses-streaming). Model availability is controlled upstream; no catalog is frozen here.

## Example and secret handling

For a Go Chat Completions model listed by the provider, launch with:

```sh
export LOOM_AI_PROVIDER=opencode
export LOOM_AI_MODEL=glm-5.3-flash
export LOOM_AI_PROTOCOL=chat-completions
# OPENCODE_API_KEY is supplied through the private launch environment.
```

For another model, use the protocol shown for it in Go's endpoint table. Keys live outside repositories in a private environment file or secret injection; never in Markdown, canvas, SQLite, screenshots or PRs. Loom does not automatically search the home directory for credentials. A controlled launch/smoke helper may explicitly read a selected environment file without evaluating shell code or printing its value.

The Linux/macOS development helper accepts a UTF-8 regular file owned by the current user with mode `600`. The file contains only `OPENCODE_API_KEY='your-key'` (plain, single-quoted or double-quoted value; no shell expansion or `export`). Keep it outside the repository, for example `~/.config/loom/opencode.env`. After setting the non-secret variables above, launch with:

```sh
python3 scripts/with_ai_env.py --env-file "$HOME/.config/loom/opencode.env" -- npm run tauri -- dev
```

The helper only injects the key into its child environment. It does not alter shell profiles, store the key in Loom, or automatically forward it to a test machine. For the bounded live probe, build the example first (no provider call during build), then launch explicitly:

```sh
cargo build --locked -p loom-core --example ai_smoke
python3 scripts/with_ai_env.py --env-file "$HOME/.config/loom/opencode.env" -- target/debug/examples/ai_smoke
```

The probe caps output at 256 tokens and runtime at 45 seconds, makes one request without automatic retry, and records only success/failure rather than returned text. Run it only when intending to use the provider account. Offline helper checks: `python3 -m unittest discover -s scripts -p test_ai_env.py -v`.

## Verification and limits

Write failing regressions first. Test configuration defaults/overrides/rejections, exact prepared requests, auth/client/session headers, all protocol streaming/error/usage/end conditions and cancellation using loopback HTTP. Run the full Rust workspace, fmt, contract Clippy/drift, frontend tests/typechecks/build. Independently review before staged PR delivery. Frozen sources/dependencies remain unchanged.

Provide an opt-in bounded live smoke through the actual AI service with a synthetic coding prompt, no user document context, one request, a small output budget and a timeout. Live acceptance requires the owner's safely configured Go key; missing credentials do not block offline implementation and must remain explicitly unverified. Docker can execute native Rust/runtime tests; Windows/macOS and full native GUI acceptance remain deferred.
