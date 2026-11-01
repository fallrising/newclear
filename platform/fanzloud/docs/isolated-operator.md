# Private isolated-task entry

The verified route is [M1 isolated acceptance](acceptance/M1-isolated.md). Operator
workflow: open the configured private HTTPS origin, log in, select the registered
project/base and Claude Code profile, enter the repair, submit once, observe states,
then download the final diff and inspect checks. Cancellation is a request; only
confirmed cleanup means the workspace stopped. Unknown submissions stay locked after
reload and must be reconciled; opening another tab is not a reconciliation procedure.

For the trusted administrator, use the existing Agent Platform deployment/runbooks
and [external-workspace contract](../../agent-platform/docs/EXTERNAL-WORKSPACE.md):
register one fixed repository bundle/base and immutable guest; enable
`external_workspace_enabled`, set sealed node/Connector `max_claims:1`, register
capacity, and create a `claude-subscription` profile with fixed verification commands
and deadline≤600. Start AP's API and worker with a private `SUBSCRIPTION_CONFIG`.
The worker owns jobs/leases; a Web request never starts a second coordinator.

The subscription config is a private0600 JSON file with `executable`,
`executable_sha256`, `state_dir` (0700), `connector_origin` and
`connector_token_file`. Pin the official CLI exactly as the acceptance receipt;
credentials stay in the trusted existing login environment. No provider credentials
or Connector token enter the browser or guest. Do not replace the pin or enable
built-in host tools to solve a failed preflight.

Run Rust behind the existing private HTTPS terminator:

```sh
CODEBOX_MODE=isolated \
CODEBOX_LISTEN_ADDRESS=127.0.0.1:18449 \
CODEBOX_PUBLIC_ORIGIN=https://localhost:18447 \
CODEBOX_AGENT_PLATFORM_ADDRESS=127.0.0.1:18448 \
cargo +1.97.1 run --locked -p codebox-control-plane
```

AP's configured origin must equal that HTTPS origin. The upstream is one literal
loopback address, not an arbitrary URL. Use an approved private tunnel and trusted
certificate for human operation; do not expose the test listeners publicly. Existing
operator bootstrap/session rules apply; passwords are not stored in browser storage.

The checked-in `acceptance/m1-browser.mjs` is an explicit acceptance launcher, not a
resident service. Its private inputs are `M1_PRIVATE_DIR` (operator-only config and
certificate) and `M1_PLAYWRIGHT_MODULE` (existing pinned Playwright); default mode
submits a real task and must never be invoked as a health check. `--preflight` uses
real authentication plus a labelled intercepted lost-response test, with no AP task;
`--faults` validates denials/queued cancellation and reads the prior live result without
calling a provider. Keep their receipts distinct. The accepted live run is not restarted.

M1 does not provide deployment automation, arbitrary project onboarding, a second
vendor or durable Fanzloud recovery. Those limits are visible in SUCCESS/SDD; installed
libraries, a passing CLI or a merged PR alone do not establish owner readiness.


## M2 Codex configuration (live acceptance pending)

The same Web catalog now admits `codex-subscription` as well as Claude. Register a
Codex profile with the same bounded verification/deadline contract; the exact model
reference is `codex-subscription:gpt-6.1-sol`. Its private `CODEX_SUBSCRIPTION_CONFIG`
contains `executable`, `model_catalog_json`, `state_dir`, `connector_origin` and
`connector_token_file`. The driver pins official CLI0.166.0 and the qualified unmodified
model-catalog bytes; mismatches fail closed. Existing trusted ChatGPT login is required,
API-key environments are refused. A fresh private CLI home references that login;
no credentials or built-in host execution environment are exposed to repository tools.

Once AP returns a confirmed run ID, the operator may explicitly submit another task
and select either recent task. An unknown submission remains locked; a late response
for A cannot replace selected B. Resource admission remains AP's responsibility and
currently stays at one VM. Code availability does not establish simultaneous isolation
or second-vendor live acceptance; see the M2 acceptance record when available.
