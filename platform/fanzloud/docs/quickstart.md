> Current approved M1 entry: [isolated operator workflow](isolated-operator.md) and [actual browser acceptance](acceptance/M1-isolated.md). The P0 Cloud quickstart below is historical; live Cloud AC-04 remains unverified.

# Private P0 operator flow

This is the 2026-10-30 resumed P0 milestone (T-0442), not a public deployment or a persistence claim.
[Runtime setup](../README.md#run-the-private-p0-control-plane) remains authoritative. The latest
[acceptance specification](specs/SPEC-T008-p0-real-browser.md) keeps fake and live evidence separate.

## Actual call chain and evidence before this run

| Segment | Code | Established evidence / gap |
| --- | --- | --- |
| Authenticate, submit, Show diff buttons | `apps/control-plane/web/p0-app.js:mountP0App`, `p0-client.js:authenticate/submitPrompt/showDiff` | Accepted controller and synthetic review-browser evidence; actual Rust browser join passed in T008 (fake provider) |
| HTTPS origin, bootstrap cookie, HTTP/WS | `apps/control-plane/src/main.rs:build_control_plane`, `routes.rs:router`, `websocket.rs:upgrade` | Production composition implemented; T007 exercised real loopback HTTP/WS with a wire-equivalent Rust client |
| Session start, worker polling and ordered live events | `crates/codebox-session-runtime/src/runtime.rs:start_turn/subscribe/read_diff` | Concrete fake-Codex integration accepted; actual Chromium composition passed in T008 (fake provider) |
| Trusted credential scope, submit/status/diff process | `crates/codebox-agent-codex/src/scope.rs`, `cloud_runner.rs`, `cloud_lifecycle.rs`, `cloud_diff.rs` | Strict executable/path/permission checks and fake executable tests exist |
| Official Cloud command/output boundary | `crates/codebox-agent-codex/src/cloud.rs:CloudInvocation/decode_cloud_*`, `docs/fixtures/codex-0.145.0/cloud/` | Source-derived fixed 0.145.0 fixtures, not live captures; AC-04 pending |
| Final diff to displayed text | `routes.rs:session_diff`, `runtime.rs:read_diff`, `p0-client.js:showDiff`, `p0-app.js:render` | Implemented, fake wire path accepted; actual page proof passed in T008 (fake provider) |
| Durable store to P0 session/host runtime | `crates/codebox-event-store`, `codebox-session-runtime`, `apps/node-agent`, `apps/boxd` | Store independent; integration absent, host runtimes scaffolds (AC-05) |

## First executable acceptance

Build the real binary using the README command. The T008 acceptance driver loads these exact
embedded assets through private trusted HTTPS, exchanges a fresh bootstrap token via the page,
confirms `logged_in`, submits once, waits for actual Rust WebSocket lifecycle events and Ready,
clicks Show diff and compares the exact synthetic text. It refreshes without resubmission and logs
out. Only the Codex executable is fake. A Node TLS proxy forwards bytes; it does not implement API
routes. The old Node review fixture and T007 wire-equivalent client do not satisfy this gate.

The acceptance runner uses installed browser tooling and a bounded isolated runtime; it is not a
runtime dependency of Codebox. The runnable command and source-bound result are recorded in
[T008 acceptance](acceptance/T008.acceptance.md). Failures and missing prerequisites remain visible.

## Live operator gate

Before starting, provide the exact official `codex-cli 0.145.0`, an existing authenticated operator
credential directory satisfying mode 0700, separate private state and working directories outside
repositories, the administrator-selected Cloud environment and branch, private trusted HTTPS,
and a fresh bootstrap token. Never put credentials into the repository or evidence. The browser
cannot choose the executable, repository, environment or branch.

The 2026-10-30 preflight verified a separate official 0.145.0 executable and its exact version/help contract. It found the default CLI at 0.165.0, all nine CODEBOX startup variables absent,
and the default logged-in credential directory at mode 0775. Login status alone therefore does
not establish a valid product setup. Do not change shared credential permissions or copy secrets
to work around this result. A separately pinned executable can be inspected without replacing the
default CLI; official version/help observations still do not prove live Cloud availability.

The bounded live action is one documentation-only Cloud task in the operator-selected target,
`--attempts=1`, up to ten minutes of status observation, then one final diff read and logout.
A proposed prompt is: “In the selected repository, add one short documentation sentence explaining
that this is a private single-operator smoke check. Change no code, dependencies or configuration;
do not push, open a PR, deploy, access secrets or run external services.” The operator must approve
the actual target and prompt before use. Unknown submission never authorizes a retry. Only date,
CLI/browser version, fixed stage and source revision may enter live evidence.

Until live passes, **AC-04 remains pending** and the owner cannot rely on this checkout to complete
a real browser-to-Cloud task without the required setup. The local acceptance runtime is temporary,
not an operator deployment or a persistent URL.

## Next smallest persistence milestone

After P0 acceptance, define one durable P0 session adapter: append authoritative session events
before publishing them, reconstruct the same session/turn and replay cursor after a process
restart, and preserve unknown-submit reconciliation without a second Cloud submission. Verify a
single accepted fake task across controlled restart, event/store fault and replay cases. Reuse the
accepted event store; first specify compatibility between its versioned domain events and P0
lifecycle events. Do not include node-agent/boxd, multi-user auth or sandbox execution. This would
advance AC-05; it would not complete all of AC-05 or the platform.
