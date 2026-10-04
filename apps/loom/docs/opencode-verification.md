# OpenCode integration verification

Verified on 2026-10-04 against the implementation of [the provider specification](opencode-provider.md). Rust checks ran in Linux Docker with Rust 1.88; frontend and helper checks ran on Linux. No real provider request was made: account access and live model compatibility remain unverified until a private Go key is available.

| Check | Result |
|---|---|
| `cargo test --locked --workspace --no-fail-fast` | 177 passed, including 10 configuration/service tests and 10 Responses tests |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --locked -p loom-contracts --all-targets -- -D warnings` | Passed |
| `cargo build --locked -p loom-core --example ai_smoke` | Passed; build only, no provider call |
| `npm test` | 102 passed across 13 files |
| `npm run typecheck:contracts` / `npm run typecheck:app` | Both passed |
| `npm run build` | Passed; existing large-chunk advisory remains |
| `python3 -m unittest discover -s scripts -p test_ai_env.py -v` | 3 passed |
| Generated contracts | All 26 generated TS paths and hashes unchanged after Rust tests; no additional files |
| Frozen sources, schemas, fixtures, dependencies and lockfiles | Unchanged |
| `git diff --check` | Passed |

The service tests make actual loopback HTTP requests through `AiService` for all three protocols. They verify operation paths, selected authentication, active/pinned context, token budgets, stable Go session identity, cancellation, redirect refusal and key redaction. Responses regressions cover fragmented Unicode/SSE, refusal deltas, final usage exactly once, provider errors, malformed input, premature EOF and completion before connection close. Existing stream, PTY, filesystem and SQLite recovery tests also pass.

A browser smoke against the production build with mocked Tauri IPC passed three flows: invalid configuration blocks sending even with a key present; missing Go key identifies `OPENCODE_API_KEY`; valid settings send once and render early streamed text and usage. This checks the frontend integration, not a native desktop window or real provider connection. The harness initially omitted the document-dirty IPC call; adding that mock and rerunning removed its error banner.

Configuration and protocol workers used separate worktrees; a third model independently reviewed their final changes, the frontend behavior and the private-file helper. Behavioral regressions were observed failing before the implementation and passing afterward.

## Remaining acceptance

The opt-in `ai_smoke` example uses the same service as Tauri, one synthetic coding prompt, no document context, a 256-token output cap and a 45-second timeout without retry. Follow the [private-file launch instructions](opencode-provider.md#example-and-secret-handling) when a Go key is configured. A successful probe will verify that selected account/model/protocol combination only; it will not establish all-model support.

Windows/macOS acceptance and full native GUI verification for this change remain deferred. Offline Linux success does not establish live API access or those platform results.
