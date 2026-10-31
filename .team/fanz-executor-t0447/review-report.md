STATUS: PARTIAL

## Summary

Independent review of the T-0447 external workspace implementation on base
`67267591808e83ad72914d3c594ace4fcb32244e`, with uncommitted root/worker changes.
This is an interim review before real VM and browser/subscription evidence.
It is not acceptance of EX-02/EX-03 or any Fanzloud FN criterion.

The implementation has one genuine AP lifecycle authority: PostgreSQL job claim,
committed lease heartbeat, connector fence and durable operation journal. External
preparation does not start OpenHands; fixed trusted guest code drops groups/GID/UID,
sets no-new-privileges and clears environment before repository operations. File
operations use descriptor-relative no-follow opens and reject hardlinks/nonregular
files. Root attestation requires quiescence before/after tools. Cancellation/release
retain observed ownership/removal requirements. Those paths are coherent on inspection.

### R1 — uncertain MCP delivery must close execution admission (blocking)

Initial `subscription_mcp.py` generated a fresh UUID for each received JSON-RPC call
and continued after a connector exception. A completed effect followed by a lost HTTP
reply could therefore be executed again, despite the backend's idempotency journal.
A warning to the agent not to retry does not enforce the contract.

Reviewer reproduction used the real `serve` function with a synthetic connector,
feeding the same RPC id7 twice: first connector call raised a lost-response error,
second returned success. Observed `backend_calls_after_lost_response=2` and
`distinct_operation_ids=2`. No provider, VM or network operation occurred.

Root revised this to a durable bridge Journal, deterministic UUID5 per run/RPC identity,
completed replay and a closed-admission latch on exceptions. One crash window was
reported after that revision: a started journal operation surviving process death must
also block every new RPC identity on restart, even if the exception handler never ran.
Required regression: preseed a started operation, reopen bridge, request different ID;
assert zero connector calls. Final review of this correction/evidence is pending.

### R2 — CLI deadline and output bounds (blocking, fixes under verification)

Initial `subscription_claude.execute` wrote up to20KB to a blocking stdin pipe before
entering its deadline loop. A CLI not reading stdin could block past the approved
ceiling. A fast-exiting CLI could also bypass polling output limits and trigger an
unbounded `read_text` afterward.

Root has replaced pipe feeding with a private prompt file, added post-exit size checks,
and added a separate monotonic deadline thread that stops the owned process group,
independent of the DB polling path. Source correction observed; blocked-DB/process
regression evidence and final source hash are pending.

## Verification

- Real bridge synthetic lost-response/repeated-RPC reproduction described above — passed
- Inspected actual root logs: subscription profile/claim bounds2 cases and unknown
  subscription recovery1 case use real PostgreSQL and pass; unknown recovery driver
  call count stays1 with one allocation and no release — passed
- Worker report and frozen source hashes inspected; 17 focused external-workspace
  cases and native recovery supplement are reported with environment failures retained.
  Final integrated CI/evidence review remains pending — skipped
- Actual KVM isolation/cleanup and real subscription/browser journey not yet available
  to this reviewer — skipped

## Documentation

Read task assignment, preceding EXTERNAL-WORKSPACE contract, Fanzloud SDD and
SPEC-M1-qualification, component/root AGENTS and codex-evidence-gate skill.
Combining EX-03 and the first browser journey into one actual coding invocation after
EX-02 passes is a valid evidence ordering; it preserves the task and invocation budget.
No separate repeated provider call is required merely to make two receipts.

## Risks and Follow-ups

Before live: close R1 restart window, verify R2 process deadline, and pass EX-02 using
actual owned VM/tool operations, canary/cross-workspace/egress denial and observed cleanup.
Before acceptance: review integrated final source, actual CLI tool/model/exit evidence,
fixed-base diff and checks, real browser path, cleanup proof, necessary CI and PR state.
Historical Q1 or mock tests cannot close those live gates. No release/deploy approval
is inferred, and Cloud AC-04 remains unverified.

## Follow-up review: implementation and first real VM

R1 is resolved on the integrated source. `Bridge.call` now closes admission when
any durable prior operation remains non-completed, including process death before
the exception handler. The reviewer independently ran
`PYTHONPATH=src:tests_platform $NATIVE_PYTHON -m unittest test_subscription_mcp -v`:
all4 tests passed in0.015s (completed replay/conflict, lost reply/restart, caller
identity isolation, crash-after-intent/new-RPC refusal). No provider calls occurred.

R2 is resolved on source and focused evidence. `DeadlineTests` runs an actual fake
CLI with a20KB prompt and a2.5s blocked database path. The independent deadline thread
kills the child while the database caller is still blocked; `watchdog.log` records
1 test passed in2.507s. Prompt input uses a private regular file and final stream
sizes are checked before reading. No provider call is represented by that test.

The real-VM checkout correction moves the bundle from ephemeral `/tmp/source.bundle`
to the trusted root-owned `/opt/agent-platform/source.bundle`; both preparation and
fixed guest helper use the new path. `bundle-red.log` records the intended missing
path assertion; `bundle-green.log` records its pass. Added bounded prepare-stage
and redacted failure diagnostics preserve the original uncertain journal intent,
without replaying failed preparation or exposing the private details in the API.

Reviewed `qualify-vm.py`, `qualify-vm4.log` and `vm-qualification.json`: the actual
AP DB/Worker/connector path read and wrote workspace files, executed as UID2000 with
NNP, denied host/control reads, denied direct public/metadata/private connections,
and returned403 from HTTP/CONNECT proxy attempts. The intentionally unrepaired base
failed its real checks and returned a171-byte marker diff with matching hash; AP
reported cleanup confirmed. This supports FIRST_VM execution/denial/cleanup only.
It does not yet prove cross-workspace separation, real provider coding or Web.

Earlier failure cleanup logs retain cancelled/confirmed states. Final acceptance
still needs the next owned VM to prove the first marker is absent, exact actual
remote connector/helper and local driver source binding, final real browser/CLI
stream/diff/check/removal evidence and required CI. These remain open, not failed.

## Follow-up review: isolated Rust gateway and Web journey

Reviewed integrated `main.rs`, `lib.rs`, `isolated.rs`, `web/isolated.html`,
`web/isolated.js`, `acceptance/m1-browser.mjs` and `SPEC-M1-isolated-web.md` at
source commit `d7e387b70b82428cc6eeeda146bf4f7d59b70d96`. No blocking source finding
remains for the first bounded live attempt. The gateway uses a literal loopback AP
address, exact route/method allowlist, canonical run IDs, bounded request/header/body
sizes and deadlines, no redirects/retries, restricted forwarded headers and exact
mutation Origin checks. AP remains the session/CSRF/idempotency authority. Synthetic
TCP gateway checks are correctly described as contract evidence, not live acceptance.

The UI uses textContent for agent output, authenticates through AP, clears the password,
polls actual run state, and compares the authenticated downloaded diff with the displayed
final diff. An initial unknown-submit reload hole was reported: the in-memory lock
reset on refresh. Current source persists a non-secret pending intent before POST and
retains refusal across reload, clearing it only for its known run after terminal cleanup.
This does not claim cross-device reconciliation or M3 durable recovery.

Harness corrections now request the actual `total_inclusive` fixture function, require
exactly `totals.py` as changed path, and compare downloaded/displayed bytes and SHA256
with the AP result. The preflight intercepts its sole POST with a synthetic502 and labels
that refusal check separately from actual login/catalog/logout and from live coding.

The first preflight receipts must not be accepted as clean browser evidence:
`browser-preflight-container3.log` and `browser/browser-preflight.json` inspected here
still show PASS with two errors (expected synthetic502 and DELETE204 ERR_ABORTED).
Current harness source classifies those only after observing204 and a subsequent
unauthenticated session read, and writes the final receipt after browser closure.
A final late-event consistency issue was reported to root: console/pageerror still
write to browser_errors during teardown, unlike requestfailed; final live acceptance
must reassert an empty browser_errors array after teardown or classify all teardown
events separately. No new provider call is needed to correct evidence reporting.

The private live-worker wrapper was inspected read-only: before the one subscription
execution it checks the first VM marker is absent, the fresh fixture still contains the
known bug, and UID is2000. This is a planned sequential isolation check, not yet proof.
Acceptance remains PARTIAL until actual browser/task/CLI/diff/check/cleanup evidence,
execution source binding and required integrated checks are available.

Reviewed `backup-report.md` and the integrated backup.py diff: only the independently
re-derived019 schema fingerprint and provenance comment changed. The reported pristine
018→019 comparison requires the old exact hash first and exactly the two intended
backend constraints to differ; columns/functions/triggers/indexes remain identical.
The27 affected native cases passed, including restore and drift refusal. This resolves
the reported stale018-pin failures without weakening validation; it is not a claim
that the entire783-case native suite was rerun after the pin correction.

## Actual acceptance — live source33e1eb70 (2026-10-31)

**ACCEPT for EX-01–03, M1-WEB-01–05 and FN-01; full SDD M1 remains PARTIAL
because FN-06 is not yet fully implemented/evidenced.** This accepts the bounded
functional delivery, not the entire platform or a deployment. Required CI, PR merge
and remote readback remain root-owned delivery gates.

Reviewed the private actual receipts under `.local/fanz-executor-20261031`:
`browser/browser-evidence.json`, actual `browser-final.png`, `browser-final.diff`,
`live-summary.json`, `cross-workspace.json`, `source-manifest.json`,
`browser-preflight-final.log`, `remote-cleanup.json`, `patch-apply.log` and the run's
`subscription-runs/.../receipt.json` plus narrowly filtered stream metadata/tool names.
No account/token payload was required. The review made no provider or VM calls.

- Source: `33e1eb70d66eb74644e8ad81e64e8bdc69c9fe07`. Independently compared all474
  manifest file hashes to both that Git commit and the integrated current tree: exact
  match. All11 recorded remote connector/helper hashes equal the corresponding source
  hashes. Manifest records Rust binary SHA256
  `a6d143dee6fcd9ed6e929bc28d0e9d5452547b14b86958aa43b448cde2da97b5`.
- Run: `98ce2ce1-6b9f-46b7-9dd4-83e659ebe4b7`, generation1. Chromium sent one task
  POST through actual Rust/AP and observed queued→provisioning→running→finalizing→
  succeeded. The actual screenshot shows that run, completion, checks passed, cleanup
  confirmed and the final diff. Browser errors and teardown events are both empty.
- Pinned actual CLI2.1.312 / claude-opus-5-5 used existing first-party subscription;
  one invocation, exit0, final success, no permission denials, processes stopped.
  Independently recomputed stream SHA256 and matched its receipt. Init exposes only
  three MCP workspace tools; actual calls are read/read/write/exec. Every assistant
  model field matches the pin. Internal provider request count remains unknown/null;
  one CLI invocation must not be described as one provider request.
- Diff is285bytes and changes only `totals.py`: range(start,end)→range(start,end+1).
  Independently computed downloaded SHA256
  `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`, matching the
  displayed/AP result and fixed verification receipt. Base is
  `55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`. Actual fixed profile check passed;
  downloaded patch application evidence independently records all3 tests passing.
- The second owned VM, before the driver ran, reported the prior marker absent,
  unchanged buggy base and UID2000. Together with the earlier actual KVM canary,
  no-new-privileges, direct/proxy egress refusal and guest tool evidence, this closes
  EX-02's sequential single-workspace isolation scope. It does not demonstrate
  simultaneous A/B execution or stop-one-without-affecting-the-other.
- AP saved result and runtime.cleaned, state succeeded/cleanup confirmed. Independent
  remote observation receipt records zero claims, VM scopes, VM directories and owned
  hypervisor processes; CLI receipt records processes stopped. This closes the
  observed removal requirement for the live run.

The earlier harness evidence inconsistency is resolved. The final source rechecks
browser_errors after teardown and fails its process on a failed receipt. The final
preflight separates its intercepted502 and observed204 logout diagnostic from product
errors, proves unauthenticated session read, and reports zero real task submissions.
The live run contains neither diagnostic; its error arrays remain empty.

### Exact remaining M1 requirement: FN-06

The SDD includes FN-06 in M1. Its matrix requires unauthenticated and unauthorized-target
refusal, timeout, cancellation and provider-failure outcomes with differentiated UI
reasons and observed stop/pending-reconciliation status. Current evidence covers actual
login/logout, inherited backend boundary regressions, a synthetic unknown-submit reload
refusal, the real fake-CLI blocked-DB deadline test and successful actual cleanup.
Those are useful distinct layers, but not the complete FN-06 product failure matrix.

A concrete implementation gap remains: `isolated.js` never renders `run.reason`;
provider error, timeout and verification failure therefore share the generic failed
state label. The explicit gateway/UI also provides no cancellation command. The smaller
M1-WEB spec intentionally omits a cancel UI, so it can pass, but that does not waive the
parent SDD FN-06 requirement. Finish this bounded failure/reason/stop evidence before
claiming all of M1 is complete; a second real provider repair is not necessary merely
to test deterministic failure paths. FN-03 is accepted only for M1's single-task and
sequential separation portion. Full concurrent FN-03, FN-02 and later milestones remain
outside this accepted unit. Original Cloud AC-04 remains unverified.

## FN-06 completion source review — a65801df

Reviewed source `a65801df57e8340ec435ab715b79fdc890980596` and its prior
M1-WEB-06 addendum. The concrete missing reason presentation is now implemented:
operator cancellation, deadline/timeout, verification failure and agent/provider
uncertainty have separate bounded messages, with cleanup still independently displayed.
The page sends one cancellation intent containing the observed state version, stores
its non-secret refusal marker before POST and keeps cancellation disabled across reload.

The Rust gateway adds only POST of a canonical run UUID `/actions` path with a strict
JSON object: exactly cancel plus positive i64 expected_state_version. Serde rejects
unknown/duplicate fields; explicit object validation excludes sequence deserialization.
Existing Origin, cookie/CSRF/idempotency forwarding, body/deadline bounds and no-retry
mutation handling remain shared. Source review found no new blocker.

Inspected the cancel worker's meaningful route RED then10 pinned Rust gateway tests,
Clippy/format PASS. Inspected final-source real PostgreSQL lifecycle2 PASS: injected
subscription uncertainty and deadline reasons remain interrupted/unknown; recovery
retains the reason, executes the driver only once, allocates once and does not release
an unconfirmed resource. These use synthetic driver/connector with a real DB, not an
actual provider failure. Existing actual fake-process deadline/stream contract4 PASS
are a separate evidence layer. Prior cwd/setup failure is retained.

`git diff 33e1eb70 a65801df -- platform/agent-platform/src/agent_platform` is empty:
the accepted live execution modules remain unchanged. New browser/gateway behavior
still requires its own queued cancellation and read-only result replay receipts before
FN-06 can be accepted. Browser-intercepted reason projections must remain labelled as
such rather than becoming a new claim of actual provider failure or timeout.

The first actual FN-06 browser attempt found a real integration bug rather than an
execution failure: cancellation reached cancelled/operator_cancelled/not_allocated,
while the page and harness expected confirmed cleanup. Its failure is retained. The
source correction accepts only cancelled+not_allocated as "cancelled before workspace
creation", stops polling and releases the associated known submission lock; every other
unknown cleanup remains unresolved. This is the correct backend distinction and avoids
claiming a VM existed and was cleaned. Root resumes observation of the same cancelled
run, without repeating its accepted task or cancellation. The resumed harness still
issues its intentionally rejected target POST, which must remain separately labelled.

## Final FN-06 evidence review and bounded M1 verdict

**FINAL REVIEW STATUS: ACCEPT — bounded M1 implementation and acceptance evidence.**
This supersedes the earlier PARTIAL finding for FN-06. It does not replace required
final CI, merge/readback, or the owner's whole-MVP acceptance. No M2/M3, full concurrent
FN-03, FN-02, FN-07 deployment/usability or Cloud AC-04 acceptance is inferred.

Inspected `browser/browser-faults.json`, `browser-faults-final.log` and
`queued-cancel-proof.json`. Actual Rust/AP unauthenticated access returned401 and the
unregistered target returned404. The only admitted fault task is
`88e99fb3-7c81-4d51-9551-2222f0701dd8`: cancelled/operator_cancelled/not_allocated,
null sandbox_id and backend_ref, with queued/message/cancel-requested/state-changed
events and no allocation or agent-start event. Its original cancel was performed once.
The resumed browser correctly observes that same cancelled run. Its task_posts=1 is
the separately rejected target probe, not another admitted task or coding execution.

The resumed browser also downloads the original successful task's result through the
updated gateway/UI. Independently hashed both original and replay files:285bytes,
SHA256 `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb` for both.
There was no second provider execution. Browser errors and teardown events are empty;
401/404 expected diagnostics are explicit and separate.

The four failure-reason projections are explicitly PASS_INTERCEPTED_ONLY: deadline and
provider uncertainty retain interrupted/unknown cleanup; failed checks and cancellation
show their distinct reasons and confirmed cleanup. These prove presentation, not actual
provider outage or timeout. Together with the actual fake-process watchdog, final-source
real DB injected deadline/provider uncertainty without replay, actual queued cancel and
earlier owned-VM cancellation/removal receipts, they satisfy the bounded FN-06
composition specified before this follow-up. No additional live provider failure is
claimed or needed. The first failed browser attempt remains visible as the regression's
RED evidence; the resumed actual observation is GREEN.

Reviewed final uncommitted correction hashes (root will bind them to its commit and
replay binary manifest):

- isolated.js:330735a17b7685a81bea30c6a0519b508232e7d6d933f54a8bed02fcb7d5cc56
- isolated.rs:ee2101bb4c1a35a4c21aaa182e6a6cb4d53dd1e3b7c5cf4fc5030f0e2f4f9197
- m1-browser.mjs:007b7b6c4db5dca6b2cef846f11d704082838ff77165ef35bc554e0edb4da00d

`git diff --check` passes. The original live manifest remains correctly attached to
33e1eb70; the final UI/gateway replay must retain its separate version binding. The
actual AP/CLI/connector execution source has not changed between those runs.

The supported operator result is now concrete: one registered fixed-base repair can
be submitted from a private browser through the real backend, its progress observed,
and its verified patch downloaded; cancellation and uncertainty have distinct outcomes.
The remaining next work is the already defined second real vendor/concurrent isolation
and durable submission/run-reference reconciliation milestones, plus owner-operated
entry acceptance. Those are not prerequisites to honestly accepting this bounded M1.
