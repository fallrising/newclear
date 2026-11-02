# Private isolated-task entry

Current status (2026-11-02): no standing operator URL or running acceptance service.
Both formal Codex and Claude routes have [accepted M2 evidence](acceptance/M2-two-vendors.md).
Durable restart readback and [candidate-only review](acceptance/M3-readonly-review.md)
are accepted bounded slices. The original installation has now been positively
reconciled and completed the [automated current-source journey](acceptance/M3-reconciliation.md);
the separate prior reviewer store is not used as its recovery. Owner operation
confirmation remains pending. All approved windows are consumed; starting retained
services again requires a new finite window.

The initial verified route is [M1 isolated acceptance](acceptance/M1-isolated.md). Operator
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
CODEBOX_ISOLATED_STORE=/absolute/private/state/submissions.sqlite \
cargo +1.97.1 run --locked -p codebox-control-plane
```

AP's configured origin must equal that HTTPS origin. The upstream is one literal
loopback address, not an arbitrary URL. Use an approved private tunnel and trusted
certificate for human operation; do not expose the test listeners publicly. Existing
operator bootstrap/session rules apply; passwords are not stored in browser storage.

The isolated store is required: create its administrator-owned canonical parent directory
with0700 permissions, outside repository/guest mounts. An existing file must be private0600;
unsafe paths, incompatible schema or storage failure refuse startup/submission. Reuse the
same file across process restarts. Do not point it at the separate P1 event database.
Local records contain task inputs and AP references, never session cookies or provider auth.

After login, the page reads durable submission history before enabling new work. Confirmed
tasks can be reopened from that history; observed statuses retain a cursor across restart.
The history is a bounded record of observed AP snapshots, not every AP tool/event message.
An unknown submission remains blocked across fresh browser sessions. Refresh is GET-only;
it can recover a saved confirmation but never resend a task. Use the explicit 「核對提交結果」 action beside a saved unknown intent. The server reads
only the exact operator/key/operation evidence from AP and atomically confirms a matching
original receipt. Missing, inconsistent or unavailable evidence stays locked; a later
explicit action may repeat the lookup only. Do not delete the database or clear browser
storage to bypass it. This slice provides no
automatic abandon/retry or offline authentication. AP must be reachable for authorization.

The checked-in `acceptance/m1-browser.mjs` is an explicit acceptance launcher, not a
resident service. Its private inputs are `M1_PRIVATE_DIR` (operator-only config and
certificate) and `M1_PLAYWRIGHT_MODULE` (existing pinned Playwright); default mode
submits a real task and must never be invoked as a health check. `--preflight` uses
real authentication plus a labelled intercepted lost-response test, with no AP task;
`--faults` validates denials/queued cancellation and reads the prior live result without
calling a provider. Keep their receipts distinct. The accepted live run is not restarted.

Deployment automation and arbitrary project onboarding remain unavailable. M2 adds
the second vendor; M3 adds durable intent/readback and fixed-candidate review. Whole
M3/FN07 is incomplete; a merged slice alone does not establish owner readiness.


## M2 Codex configuration (accepted bounded live evidence)

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
currently stays at one VM. The prior two-VM M2 acceptance window is consumed; its
accepted isolation evidence does not authorize another parallel run.

## Fixed candidate and review

On an authorized running installation, select a completed writer and inspect/download
its immutable candidate (original task, fixed base, diff and recorded checks). Select
the other vendor's review profile and explicitly request review. The reviewer receives
only that candidate, not a full checkout; its hash-bound verdict and reasons do not
automatically mark the task Done. A rework verdict permits at most one explicit writer
rework and second review in the product contract, but any live use still needs a
window that covers it. The accepted actual review returned accept on the first round;
rework/second-review branches have native evidence only. Reopen/download compares the
same immutable bytes after Rust/AP restart. Credentials stay on the trusted side.

## Unknown recovery and final journey

The explicit Web reconciliation command uses the original immutable AP command receipt.
Task-list/title matching is
insufficient and repeating a task POST is forbidden. Do not manually bind a guessed
run, discard the SQLite file, reset a key or use a fresh store to claim recovery.

The owner approved the [bounded recovery scope](specs/PROPOSAL-M3-recovery.md).
The [wire contract](specs/SPEC-M3-recovery.md), original-installation recovery and
automated journey have [independently accepted evidence](acceptance/M3-reconciliation.md).
Owner operation confirmation remains separate and pending.
A successful confirmation means the submission is known, even if the run was cancelled;
it does not mean coding succeeded. Until those
checks pass, this document describes accepted capabilities and their startup preconditions,
not an available installation that the owner can log into now.

## Owner operation preparation — 2026-11-02

[Short steps and the exact remaining FN07 clauses](acceptance/M3-owner-operation.md)
identify the original U07 writer/reviewer, downloads and checks inside candidate JSON.
No service is running. A proposed10min zero-CLI/VM read-only window covers existing
results; it cannot alone pass the SDD's owner submit/progress/handoff actions. The
alternative15min/two-CLI owner journey also awaits explicit availability/window choice.
Neither proposal resets or reuses a consumed intent. Private connection details stay
in the trusted operator entry; no service starts from this document.
