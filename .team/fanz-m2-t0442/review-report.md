STATUS: PARTIAL

## Current decision — focused follow-up

**ACCEPT_CODE**, 2026-11-01T04:54:11Z. R1, R2 and R3 are closed for the source hashes
below. The original REWORK findings and failed evidence remain below as history.
Report status stays PARTIAL because full integration/CI and live FN02/FN03 acceptance
are outside this completed code-review gate. **Live FN02/FN03: NOT_RUN.** No claim of
milestone completion, real provider repair, simultaneous VM isolation or cleanup.

R1: inspected actual repaired source. The app-server process now starts in a private
fresh temporary HOME/CODEX_HOME/cwd, with only an auth-file reference, allowlisted
environment, and rejection of the supported system/project startup config paths.
Official endpoint, empty notification commands, disabled implicit skills, plugin
prefetch, JS REPL and delegation are pinned. A merged configuration audit occurs
before thread creation; unrelated nonempty features/extension configuration are
refused. Configuration RPC replies are redacted before the protocol log is written.
The unchanged explicit empty environments on both thread and turn still supply the
filesystem/process-tool boundary. No model-side prompt is treated as enforcement.

The supplied actual official no-turn config receipt passes the current containment
audit. Its `mismatch_keys` records default-added nested fields, not a failed current
audit: source now checks required nested fields while refusing extra enabled features.
The new exact-binary isolated synthetic boundary again shows no host marker, denied
Node/file/media/patch paths, empty resources and only the inert registered callback.
This closes the original ambient startup configuration concern for the supported
Linux route. It does not certify unknown future Codex versions or supply live receipt.

R2: inspected the SQL and regression fixtures. Generation1 is admitted only with the
completed run-bound cancellation command/result, matching state version/job generation,
ordered cancellation timestamps, zero attempts/lease, and no binding/operation/backend
state. Nullable evidence is contained inside EXISTS, so missing proof rejects. Both
subscription backend names now use the existing confirmed real-binding and released
reservation proof. Positive native roundtrips and negative mutations cover both paths.

R3: `observe` now immediately displays the selected ID/loading status and clears old
reason/error; stale errors from its own initial refresh are ignored after selection
changes. The pending and rejected B fetch regression matches the original reproduction.

Focused follow-up verification (no unchanged green suites repeated):

- Actual production changes, test fixtures, M2 specification corrections and
  `.team/fanz-m2-t0442/backup-report.md` inspected — passed.
- `.local/fanz-m2-20261101/config-probe-receipt.json` — passed within official CLI
  startup/config scope, zero turn starts. No live inference or VM evidence inferred.
- `.local/fanz-m2-20261101/isolated-boundary-receipt.json` — passed within actual
  pinned CLI / MOCK provider scope, two local fixture requests, zero live requests.
- `.local/fanz-m2-20261101/codex-review-tests-final.log` — passed:8 offline protocol
  tests, including endpoint/notify/feature/MCP refusal before thread creation and
  configuration-response redaction. Actual fake processes use the new isolated home.
- `.local/fanz-m2-20261101/backup-review.log` — passed:31 real PostgreSQL/native
  backup tests in25.637s, including both new roundtrips and negative proof mutations;
  owned test container removal recorded. Runtime/provider responses in these fixtures
  remain mocked and do not establish live VM behavior.
- `.local/fanz-m2-20261101/ui-review-red.log` — failed historical pre-fix module run;
  its concise output does not identify the individual assertion. The original review's
  independently observed failing A/B assertion remains the precise RED evidence.
- `.local/fanz-m2-20261101/ui-review-green.log` — passed:the updated test module exits
  successfully. Source includes the delayed/rejected B regression and existing
  unknown-submit lock, accepted-submit unlock and late-cancel identity cases.
- `git diff --check` at this follow-up snapshot — passed.
- Full AP/Rust/CI and live FN02/FN03 — skipped by reviewer; parent owns these
  remaining acceptance gates. Do not read ACCEPT_CODE as acceptance of those gates.

Accepted SHA256 snapshot:

- `subscription_codex.py`: `08985029c246198d596087cf45917e838cf5caff219fa7fd9db34c1b416b8347`
- `backup.py`: `a211dafaa5134356344ad4513fd40dfb1a136137e895bbadc5e54b446bd35223`
- `isolated.js`: `abc62a1f42d389e819162ac7a5cbb5b7a1860c4522d1121c3ae341a278de0f68`
- `test_subscription_codex.py`: `e61369d6bd127438285dac78a9357529f92a548cd6d9cdf287b59c209cb47d38`
- `test_backup.py`: `c2d5f10dea66389dc51881033e4a21bfcae8988faf0a013c335913527510f252`
- `m2-isolated.test.mjs`: `59cd28e58db41a31d860b4ef5dc20f51a7627e7c3e5502358da2cef52faca309`

Follow-up accounting through report finalization:5 outer exec calls with4 nested
exec_command calls and2 apply_patch calls, measured directly from this follow-up
history (the second patch corrects this count). No agent starts,
source fetches, provider/VM requests, new test executions or Git mutations. Underlying
model/provider request count, token/cost and wall-time aggregates remain unknown/null.

## First-pass summary (preserved)

Decision: **REWORK**. Independent document-first review snapshot 2026-11-01T04:46:38Z.
Do not start the live Codex route until R1 is closed. R2/R3 also block code acceptance.
Live FN02/FN03: **NOT_RUN**, not accepted by this review. The actual pinned-binary
synthetic-provider receipt proves the tested local boundary only.

Read the assigned SDD sections4–6, M2 specification, component instructions,
external-workspace contract, route/routing reports, production diff and supplied logs.
Applied codex-task-worker and codex-evidence-gate. Their linked shared report contract
was absent at its resolved path; use their explicit status/headings and task criteria.
No production edit, Git mutation, credential read, provider/VM invocation or delegation.

## Required fixes

### R1 — P1: effective configuration and startup surfaces are not qualified

`platform/agent-platform/src/agent_platform/subscription_codex.py:69` builds selected
CLI overrides, but reads only top-level `mcp_servers` from ambient user config.
`:162` reuses ambient CODEX_HOME; `:275` launches with inherited environment; `:301`
starts a thread before any effective-config audit. There is no `config/read` call.
The pinned schema explicitly permits `chatgpt_base_url` (ChatGPT endpoint), `notify`
(external host command), and `skills.include_instructions`; none is pinned/checked.
Consequently an otherwise valid existing configuration can change the qualified
endpoint or introduce host notification behavior while the returned provider remains
`openai`, empty thread environments and MCP status still pass. Implicit skills are
also not explicitly disabled despite the specification. The fixture proves one
configuration, not fail-closed admission for the other inherited configurations.

Minimal repair: pin the official ChatGPT endpoint, disable notification commands and
automatic skill instructions, and verify merged effective configuration/layers before
thread creation, rejecting unexpected routes and executable extensions. Disable or
reject inherited tool features outside the qualified inventory (e.g. `js_repl`).
Keep configuration/credential-bearing RPC responses out of raw protocol logs.
Add synthetic configuration mismatch tests that prove zero thread/turn start.

Startup caveat: an audit after process initialization alone cannot establish absence
of all startup side effects. At exact upstream commit
`6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`, app-server `lib.rs:642` constructs
`EnvironmentManager::from_codex_home` before RPC; `message_processor.rs:407` spawns
the model-refresh worker and `:557` calls plugin startup warmups before initialize.
The warmup call explicitly passes `PluginDiscoveryPrefetch`, not currently pinned.
This pass does NOT claim these calls actually launch an unsafe extension: the relevant
callee gates were not among the two authorized source files. Establish those gates,
or reject/pin the relevant startup configuration before launching. Do not replace
that evidence with an assertion that MCP status after `thread/start` proves no launch.

### R2 — P1: valid subscription histories cannot be backed up

`platform/agent-platform/src/agent_platform/backup.py:333` accepts never-allocated
runs only at generation0. Real queued cancellation in `cancellation.py:33` increments
the run and job generation to1. The new native roundtrip fails `backup_source_active`
in supplied `backup-green.log` (28 tests, one error). This is a real contract mismatch,
not merely a fixture to rewrite or a reason to remove the safety check.

Separately, `backup.py:348` admits a confirmed real binding only when backend is
`openhands`; both subscription backends are excluded even after correct release.
The new queued-cancellation test does not cover the usual completed subscription path.

Minimal repair: document and admit the exact durable, never-admitted queued-cancel
shape with matching job generation, zero attempts, no lease/operations/bindings and
confirmed cancellation evidence. Admit both subscription backend names under the
same existing real-node, provider-handle, generation and released-reservation proof.
Require real backup/restore roundtrips for queued cancellation and confirmed real
subscription histories, plus negative altered-generation/missing-proof cases. Keep
schema fingerprint validation and unresolved-cleanup rejection intact.

### R3 — P2: selecting a task leaves the previous task identity/status visible

`platform/fanzloud/apps/control-plane/web/isolated.js:68` resets diff, checks and
cancel state in `observe`, but not `run-id`, `run-status` or `run-reason`. After A is
loaded, select B with its GET pending/failing: A's identity and status remain visible
indefinitely while internal runId is B. This violates M2-04's stale-data contract.

Minimal repair: synchronously render B's identity/loading status, clear the previous
reason/error, and retain the existing async response identity check. Add delayed and
failed B fetch coverage. An in-memory extension of the existing VM-based JS harness
reproduced this: after selecting B, assertion `run-id != A` failed with actual `A`.
No test or production file was edited by the reviewer for this probe.

## Verification

- Actual diff/source and specification inspection — passed. Routing selects only the
  matching injected driver, new claims skip missing drivers, and recovery cannot
  reinvoke either subscription. Migration020 is additive and keeps exact model refs.
- Supplied `codex-protocol-final.log` — passed:7 offline fake-executable tests. Fresh
  thread/turn carry empty environments; tool callbacks check exact thread/turn/name;
  Bridge preserves UUID/fingerprint/run/generation and unknown closure; completion
  requires completed turn, at least one accepted tool, and confirmed process stop.
- Supplied `boundary-receipt.json` — passed within MOCK scope: actual binary/hash,
  exact model metadata, no host marker, inert dynamic call, denied nested patch,
  Node/file import and media paths, empty MCP resources. Zero live provider requests.
- Supplied `schema-measure-fix1.log` and production fingerprint — passed: measured
  migration019 reference and expected two-constraint020 delta; production pin matches
  measured `20727fd56d86c4c253e6c3797f469965df0364f737c6f2fe93a482126bece1fd`.
- Supplied `ap-focused.log` — failed before updated schema pin:59 tests,12 failures,
  15 errors, predominantly schema mismatch; not presented as current green evidence.
- Supplied `backup-green.log` — failed:28 tests, one error in the new subscription
  queued-cancellation roundtrip (`backup_source_active`). Parent is fixing R2.
- `node --input-type=module` in-memory harness extension with delayed `/runs/B`
  response — failed as intended for R3:1 test,0 passed,1 failed, actual run-id `A`.
  This is a targeted regression probe, not a browser/live acceptance run.
- `git diff --check` — passed, no whitespace output at the review snapshot.
- Bounded exact-source fetch via Python urllib — passed after initial sandbox DNS
  failure and a stale `codex_message_processor.rs` HTTP404 corrected to
  `message_processor.rs`; two source files retained in disposable review scratch.
- Full suites/CI and live FN02/FN03 — skipped: parent owns those gates; review does
  not repeat unchanged green suites or invoke provider/runtime. Final source-bound
  evidence and necessary CI remain required.

## Documentation

Only this report is writable in the assignment. Parent must reconcile the M2 spec
and acceptance/progress evidence after repairs; no final acceptance is granted here.

Review source hashes (SHA256):

- `subscription_codex.py`: `76b5efb0a5d6c41405153fa66169fa2d3d3ff32d2bccfe11ecaeca5de6ad2ec0`
- `backup.py`: `c6455318b090e83a941cae7191aaf2d1689f9c1c2a530bd325deb3dd3a799a35`
- `isolated.js`: `dfdf6a87d512ed9167b2113f7982de0852dcc4dde09da5d55eed2dc3bc6e2883`
- upstream `lib.rs`: `a44b0266619d6adda0c1e7135d5be18e6581cff44307e78097efecc5195f8b6c`
- upstream `message_processor.rs`: `6d81a0b5bab7172bf9ab24a6e8e05375f5623f0a8ac6d6da97c4ed184ad1085f`

Durable upstream source: https://github.com/openai/codex/tree/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src

## Risks and Follow-ups

One focused review follow-up may inspect actual repairs and new receipts; retain all
failed evidence. FN02 still needs the actual second-vendor Web repair/diff/check
receipt; FN03 needs simultaneously present isolated workspaces, actual cross-task,
secret/network denials, independent cancellation and confirmed removal. Neither
source review nor a scripted Responses fixture substitutes for these.

Tool accounting: scope is this review turn through the snapshot above. Nested agents0,
provider/VM execution requests0. Exact outer/nested orchestration totals and provider
usage/cost are unknown/null; no instrumentation was added and counts are not inferred
from worker budget or command count. Two exact-source files fetched; one DNS failure
attempt and one obsolete-path404 were retained in tool evidence.
