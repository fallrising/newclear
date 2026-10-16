# M6: controlled Workflow failures, retries and D1 effects

Status: contract for a separate original-runtime experiment; execution evidence
belongs in STATUS only after a real successful run. Historical M1–M5 contracts,
fixture, release pin and reports remain unchanged.

## 1. Question and boundary

M5 observes recovery after a callback result is already committed. M6 asks what
happens when a trusted callback commits a synthetic D1 effect and then throws
before returning its result. Compare an unguarded effect with one protected by
a stable operation key, and observe finite retry exhaustion. This is a controlled
callback-error experiment, with no daemon restart, kill, timeout injection,
rollback, approval event, external service or arbitrary caller code.

Use the original v0.2.4 Linux x64 artifact and source
`73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`, verified by the unchanged lock. A fresh
non-root disposable account owns one scope, instance, D1 database, new trusted
Worker and Workflow definition. All HTTP connections remain numeric loopback.
Only that invocation's verified scope may be removed.

## 2. Pinned source facts

The following are inspected source facts, not executed runtime results:

- [policy.rs](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/core/src/workflow/policy.rs)
  defines `retries.limit` as additional business attempts. Explicit policy below
  permits an initial attempt and one retry; durations are numeric milliseconds.
- [runner.ts](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/packages/runtime/src/workflows/runner.ts)
  supplies callback `ctx.attempt` (one-based), `ctx.step` and normalized frozen
  `ctx.config`. Record context rather than maintaining a JS closure counter.
- [durable settlement](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/storage/src/scheduler/workflow/durable_settlement.rs)
  permits retry of an ordinary callback failure until the additional-attempt
  limit is exhausted. Recovery may reuse an attempt number; it is not a universal
  unique execution identifier.
- [public detail mapping](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/cloudflare_v4/workflows/instances.rs)
  exposes placeholder step `attempts: []`, zero config and `output: null`.
  These cannot prove attempts or policy. For one `step.do`, expect one step of
  type `step`, name `controlled-effect`, with terminal success true/false.
  Top-level params are decoded original input. Complete has success=true,
  error=null and decoded Workflow output. Errored has success=false, output=null
  and generic error `{name:"Error",message:"Workflow execution failed"}`.
  The public error does not identify the internal exhaustion code uniquely.

## 3. Fixed cases and fixture

New `fixtures/retry_worker.js` exports `RetryFlow`; script `retry-worker` and
Workflow `retry-flow` are fixed. Reuse the existing lab instance and lifecycle
helpers without changing their global constants or the historical fixture.
The public HTTP fixture supports only GET `/health` and GET `/jobs/{jobId}`.
Health is exactly `{fixture:"open-compute-m6",ok:true}`. Requests cannot select
SQL, policy, an outbound destination or caller code. Reject invalid identifiers
and unsupported routes/methods. Workflow input is exactly `{jobId,caseName}`,
with a bounded lowercase/hyphen ID and one of the three fixed names below.

Every `step.do("controlled-effect", config, async (ctx) => ...)` uses exactly:

```js
{ retries: { limit: 1, delay: 100, backoff: "constant" }, timeout: 5000 }
```

Create three tables through bounded management D1 queries: `retry_jobs` with
unique id, case_name and completed default0; `retry_entries` with independent
auto-increment sequence, unique per-entry identity, job_id, attempt, retry_limit,
delay_ms, backoff, timeout_ms, effect_acknowledged default0 and outcome_marker
default `entered`; `retry_effects` with independent row identity, job_id and nullable
unique operation_key. All fixture values use bound SQL parameters.

Each callback appends an entry **without deduplicating by attempt**, retaining
a fresh independent entry identity for its later update. Record bounded context
values before rejecting unexpected attempt/policy: invalid values use fixed
sentinels that cannot pass validation, so an unexpected third callback is not
hidden by an early context rejection. Cap stored entries at3 per job with a
conditional insert; the third entry already fails the exact two-entry oracle.
After recording, require the expected context and await its D1 effect insertion. Unguarded/exhausted insert a fresh
row with null operation_key; idempotent inserts the same job-specific stable key
with ON CONFLICT DO NOTHING. The row is itself the measured logical effect:
there is no separate dedup ledger/counter transaction to claim as atomic.
After the effect statement succeeds, update that exact entry to
effect_acknowledged=1 and outcome_marker `throw` or `return`, await that update,
then synchronously perform the fixed throw/return with no intervening I/O.
Transient cases mark `throw` and throw on attempt1, then mark `return` and return `{jobId,caseName,attempt:2}` on attempt2. Exhausted throws on both attempts;
its failure is not caught. Both exhausted entries mark `throw`. Each expected
throw uses a fixed synthetic message. Missing effect acknowledgements or outcome
markers fail; attempt counts plus final effect_count alone are insufficient for
the post-effect injection premise. These markers record the reached post-effect
checkpoint/intended outcome; public generic errors do not independently identify
the exception cause or exclude acknowledgement-loss windows.
After successful step return, an ordinary awaited D1 update sets completed=1,
then the Workflow returns that result. Do not add a second named step.

| Ordered case | Recorded callback attempts | Effect rows | completed | Terminal |
| --- | --- | ---: | ---: | --- |
| unguarded | [1,2] | 2 | 1 | complete |
| idempotent | [1,2] | 1 | 1 | complete |
| exhausted | [1,2] | 2 | 0 | errored |

Record every entry in sequence order, including repeated same-attempt entries;
any extra/missing/reordered entry fails the fixed experiment. The read endpoint
returns exactly `job`, `job_count`, `entries`, `entry_count`, `effect_count`.
`job` has exactly id/case_name/completed; an entry has exactly
attempt/retry_limit/delay_ms/backoff/timeout_ms/effect_acknowledged/outcome_marker.
Terminal entries require strict integer effect_acknowledged=1, with outcome
markers `[throw,return]` for transient cases or `[throw,throw]` for exhaustion.
Aggregate counts are actual D1
queries, and entries are selected with a fixed small limit (at most3) so overflow
is observable but response size remains bounded. Missing job and unexpected
counts fail the harness; no successful truncation hides extra entries.

Before each Workflow creation, require one original seeded job of the correct
case, completed0, no entries and no effects. Seed only before creation. Create
exactly one original Workflow per case and require returned id matches the
requested ID. Poll its fixed GET path to the expected terminal; unexpected
terminals fail. Compare exact params, step_count1, sole step name/type/success,
terminal success/error/output and the D1 observation. Repeat terminal GET and D1
GET once and require the same validated projection, including entries. These
are finite observations, not proof that no future execution can occur.

## 4. Harness and budgets

Use a separate stdlib `retry.py` runner and pure `retry_contract.py` validation/
projection module. `make integration-retry` invokes `python3 retry.py` with
existing-style `--port`, `--cache`, `--output` options. No arbitrary fixture or
runtime option is added. Reuse imported lab preflight, pinned download, bounded
HTTP, Process, OwnedScope, redactor and deadline helpers; do not monkeypatch them.
Upload only the fixed new fixture with explicit RetryFlow/DB/FLOW metadata.
Require actual new Worker health and binding/database identity; preserve exact
fixture SHA256 in sanitized evidence. Use the same artifact path no-clobber,
credential file ownership and generated-secret scan as existing scenarios.

A 300-second hard scenario deadline starts before first daemon spawn and covers
setup/deployment/all cases. Each case has one absolute60-second deadline including
initial observation, creation, polling and both readbacks; it is never reset.
Each HTTP request is capped by its existing20-second wall-clock bound and remaining
case/scenario budget. At most256 GET attempts total during cases; charge before
I/O including failed requests. Stop at budget exhaustion before network I/O.
The CLI/setup/start/download bounds remain finite; no elapsed-time claim about
100ms backoff or throughput is made. The callback timeout is policy, not an
injected test stimulus. Host scheduling and kernel-blocked I/O remain limitations.

Separate final cleanup budget150seconds; verified owned removal30seconds;
exclusive evidence write10seconds. Always attempt bounded cleanup after scenario
failure, but never delete on unknown ownership/process identity, surviving owned
generations or observer/drain errors. Success requires the daemon was running,
received normal SIGTERM, exited0 without force, observed owned generations exited,
threads drained and scope marker/identity passed before removal. Unexpected prior
daemon death cannot count as successful shutdown. No old scope is adopted.

## 5. Evidence contract

Whole report remains <128KiB with secret scan, fixed error categories and no raw
runtime/API errors, SQL, argv, local paths, credentials or process logs. Top-level
records schema_version1, scenario `controlled-workflow-retries`, run_id, command,
harness_commit, environment, unchanged upstream lock, verified runtime version/
artifact hash, fixture_sha256, instance identity, daemon identity, acceptance,
result/phase, final_shutdown, scope_removed, evidence_file_written and retries.
Only observed optional fields appear on partial failures. Error categories are
preflight/pin/bootstrap/deployment/case/schema/deadline/ownership/cleanup/evidence/
interrupted; errors cannot introduce arbitrary strings. Only whitelisted release
identity and synthetic public IDs enter the report. Reject bool-as-int, NaN,
Infinity, unexpected fields, values, duplicates and oversized serialized data.

The retry extension has exactly schema_version1, policy, limits, limitations,
cases and get_requests, within16KiB. Policy has exactly retry_limit1/delay_ms100/
backoff `constant`/timeout_ms5000. Limits have exactly cases3/case_seconds60/
scenario_seconds300/max_gets256. Limitations are fixed:
controlled_callback_errors=true, crash_tested=false, power_loss_tested=false,
synthetic_d1_only=true, external_exactly_once_tested=false,
future_execution_unobserved=true, public_attempt_history_used=false.
get_requests is a strict integer0..256.

Cases are a validated ordered prefix (none through all3). Each has exactly name,
job_id, workflow_id, initial, entries, entry_count, effect_count, completed,
terminal and stable_readback. Initial has job_count1/entry_count0/effect_count0/
completed0. Entries are exactly the two recorded context objects described above,
attempts1/2, explicit policy, effect_acknowledged=1 and case-specific
post-effect outcome markers. Terminal has exactly status/success/error/output/
step_name/step_type/step_success, with the case-specific values above; no raw
placeholder fields or inferred internal error code. stable_readback=true only
after both repeated reads compare equal. A case is appended only when all its
observations pass. A failure may retain completed cases and charged GET count,
never fabricate later cases or turn missing observations into zero success.

Pure module interfaces freeze the parallel implementation boundary:
`CASES`, `POLICY`, `SCHEMA_SQL` (three fixed CREATE statements),
`validate_row(value, job_id, case_name, *, terminal)` returning validated row,
`validate_terminal(value, job_id, case_name)` returning terminal projection,
`case_result(case_name, job_id, workflow_id, initial, row, terminal)` returning
one completed case after caller confirms repeated read equality,
`initial_retries()` and `project_retries(value, *, complete=False)`.
Row validation requires strict exact fixture keys and expected values; initial
and final observations have the same schema. Terminal input may contain expected
upstream metadata but only the specified fields are projected. Builder may
request a root-owned interface correction before implementation integration.

Success emits only after all three cases, normal shutdown, owned removal,
projection/secret scan and exclusive report write. Failed output-path validation
never writes even a diagnostic file to that path. Failed projection/write revokes
the evidence gate and returns nonzero with a bounded safe failed report.

## 6. Acceptance

| ID | Required observable proof |
| --- | --- |
| M6-01 | Exact original pin/fresh nonroot scope/new trusted fixture hash/deployment/health and original resources |
| M6-02 | Unguarded transient: original IDs, two recorded contexts1/2, two committed effects, complete and exact output |
| M6-03 | Idempotent transient: same two callback contexts, one logical effect, complete and exact output |
| M6-04 | Exhausted: two recorded contexts/effects, completed0, errored/false/null and exact generic public error; no invented code |
| M6-05 | Repeated readbacks stable, normal owned shutdown/cleanup, strict sanitized original report exclusively written |

## 7. Verification and delivery

Red-Green-Refactor covers wrong/missing job or case, duplicate/reordered/extra
entries (including an unexpected third callback), policy/context mismatch,
missing post-effect acknowledgement, wrong outcome marker, a first-attempt D1
failure followed by second-attempt success, incorrect effects/completion, unexpected
terminal/output/error/params/step metadata, strict schema/types/size, changed
readback, creation ID mismatch, deadline/GET budget before I/O, failed startup,
unexpected daemon death, ownership/observer/survivor/drain/cleanup/write failures.
Mocks prove harness boundaries only; fixture text matching is not JS behavior
verification. Root runs the complete unittest suite; preserve all old scenarios.

A new separate fresh non-root Python3.11 CI job runs this exact original artifact
with a10-minute job cap, immutable existing action pins/read-only repo permissions,
no persisted checkout credentials and only its explicit sanitized report artifact
for7days. Existing M1–M5 jobs and189 baseline tests remain. Independent contract,
implementation and actual original report/log/tested-tree review are required.
Preserve the first successful report bytes/hash and its exact actual checkout/
complete Git tree; later validation never becomes its original source. Commit
SDD before code; normal PR/CI/merge and remote content readback precede delivery.

## 8. Limits and operator meaning

The synthetic D1 effect is a single local insert and stable key, not a general
application transaction/outbox, external payment/email effect or exactly-once
system. Entry logging, effect insertion, completion marking and Workflow result
settlement are separate operations. Controlled throws do not model process
crashes between those operations, power loss, retry storms, long-duration soak,
concurrent callbacks, arbitrary tenant code, host networking isolation, upgrades,
portability, HA, capacity or production adoption. Generic public errors alone
cannot prove exhaustion: fixture identity, recorded contexts/effects and exact
terminal observations jointly support only this prescribed experiment.
