# SDD M5: SIGKILL at a publicly committed waiting checkpoint

Status: implementation contract; executed results belong in [STATUS.md](STATUS.md).
Created: 2026-10-15. Baseline main: `4db45139bac19d6ffc5f12c215a80faed51378da`.
Scope: this lab and its existing scoped CI. Extends M1 without changing M1–M4
contracts, original reports, fixture, cold backup semantics or artifact pin.

## Outcome and selection

Add one separate `integration-crash` experiment on the unchanged original
open-compute v0.2.4 Linux x64 artifact in [the lock](../upstream.lock.json).
At a publicly committed waiting Workflow checkpoint, abruptly terminate the
daemon and its freshly observed live authorized runtime generations with
SIGKILL. Start a new daemon over the same owned scope and require read-only
original application readback before completing the original Workflow.

M1–M4 already answer graceful restart, complete same-path cold restore, bounded
resource windows and cold disk endpoints. A checkpoint process crash is a small
remaining operational gate that uses the existing fixture and one artifact.
Power loss requires host/filesystem authority; in-flight interruption requires
new replay/effect semantics; portability and upgrades require other environments
or artifacts. None is included here. No new workload route, package, service,
host adapter, deployment, upstream patch or provider maintenance is needed.

The kernel, runner and filesystem stay alive. Signals are sequential and
generation gated; this is neither atomic whole-tree termination nor power loss.
Only the lifecycle owner's observed generations are covered. Previously
unobserved, escaped or between-observation descendants remain unknown.

## Fixed scenario and gates

1. Use a fresh disposable real non-root Linux x64 account/CI runner. Verify the
   original artifact bytes/SHA256, create only a fresh owned scope, deploy the
   existing trusted Worker with D1/Workflow bindings, and submit the same bounded
   original job twice. Strict integer row_count=1, callback_count=0 before the
   Workflow, completed=0 and exact job identity/payload must hold.
2. Create one original Workflow. Public status must be waiting and its named
   instrumented-callback step publicly successful. The original D1 row must have
   strict integer counter=1, completed=0 and a nonempty stored nonce. Record the
   original scope/data/control/scheduler identities, config digest,
   instance/account/database identities, immutable deployment/version/script etag/runtime/D1/Workflow bindings, and original synthetic Workflow ID.
3. Refresh lifecycle observation; require a live original daemon and at least
   one live owned child, no observation error. Freeze the live authorized target
   set. Signal the daemon FIRST to prevent deliberate supervisor respawn, then
   each frozen child, re-reading PID/start generation immediately before every
   SIGKILL. Never send SIGTERM as the stimulus; never kill by name or unverified
   PGID. Require every selected generation actually receives SIGKILL. A vanished,
   zombie, reused or unreadable required target before its signal fails, even
   if parent loss caused its exit. Do not relax this condition after a CI failure.
4. Reap the direct daemon and require return code -9. Require every retained
   lifecycle-authorized generation nonlive, no observation error, bounded reader
   and monitor closure. Only this exact verified intentional-crash receipt
   authorizes restart. No fallback to graceful shutdown, new target adoption,
   reconstructed state or replay of a different scenario can pass.
5. Check bounded scope ownership and start the same pinned binary with the same
   scope/config/data/UID/path in a new process generation. No setup, resource
   creation, deployment, job submission, Workflow recreation/restart or reseeding
   occurs after the stimulus. Existing read-only instance CLI enumeration is
   allowed. HTTP readback uses a GET-only client that refuses writes before
   network I/O: health, account identity, original D1 row including row_count=1,
   and original Workflow waiting. Read-only deployment/version comparisons must equal their pre-crash observations, including original D1 database binding UUID; do not infer database identity from the control DB inode alone. The existing deployment_observation may gain a with_r2 argument defaulting true so M2 stays unchanged, while M5 supplies false. Require original state_identity equality,
   original instance/account/database identity and byte-equivalent canonical
   JSON row with counter=1, completed=0 and unchanged nonce.
6. Only after all readbacks pass, use a new ordinary client to send approval to
   the original Workflow ID. Require complete, identical job ID, counter=1,
   original nonce and matching original output. The restarted daemon must exit
   normally on SIGTERM with exit0, no forced termination or observation error,
   and all observed owned generations nonlive. Remove only the owned scope
   after verified process exit and bounded marker/identity validation.
7. Emit success only after cleanup and exclusive sanitized evidence writing
   succeed. Failures retain failed/not_run later gates; no unavailable runtime
   or incomplete crash can become passing or skipped integration.

## Process boundary and helper interface

New standard-library `crash.py` consumes the existing Process owner. It does not
import lab.py, discover by process name, parse arbitrary paths, manage a scope,
restart a daemon or grant deletion authority. The harness supplies its existing
bounded numeric `process_info(pid)` reader:

- `initial_crash()` returns a fresh strict not_run receipt.
- `abrupt_shutdown(owner, *, deadline, read_identity)` returns a verified
  receipt or raises `CrashError(reason, receipt)` with validated failed partial
  observations and a fixed public reason.
- `project_crash(value)` validates and rebuilds all public fields.
- `initial_readback()` returns fresh all-false/zero readback;
  `project_readback(value, *, complete=False)` strictly rebuilds its exact fields,
  and complete=True requires every readback control and minimum GET count.

The owner supplies identity, snapshot(), live(), retained observed identities,
direct Popen handle and finish_threads(). The frozen set must contain its root
first, then unique child PID/start generations in deterministic numeric order.
Maximum 64 live targets; existing /proc scan8192 and retained history1024 ceilings
remain. An excess fails before signals; never truncate ownership or receipts.
The helper validates root-first against the actual owner identity, not array position alone. PID/start is ownership; numeric PGID is recorded only as observed metadata.
Every signal additionally requires the recorded generation still non-zombie.
Signal permission errors/ESRCH are fixed failures, not a silent successful exit.
Existing owner signaling remains unchanged for M1–M4.

Recheck retained history for live survivors while reaping the direct child,
using bounded polling. Zombie descendants are observed nonlive, not proof the
harness reaped another parent's child. Close observers via existing finite
joins and verify no thread remains/no observation error before returning.
No helper changes signal handlers; the main harness wraps the operation in its
existing nested deadline context. Process enumeration and identity-read/kill
are not atomic; PID/start validation reduces race exposure without claiming
hostile same-UID containment.

If a required signal or observation fails, do not restart or approve. Cleanup
may use only the existing lifecycle owner to stop known live processes; unknown
ownership/exits/drain prevent scope removal. Track only a successfully verified
crashed owner as intentional; an unexpectedly dead final daemon must still fail.
A received harness interruption is failure, never a verified crash receipt.

## Exact public crash schema

Top-level scenario: `checkpoint-sigkill`; acceptance exactly M5-01 through M5-05.
Do not mark historical AC-06 graceful restart passed for this scenario. Reused
functional controls have their existing semantics where applicable; M5 gates
alone govern the crash. Other historical scenarios remain separate regressions.

The `crash` extension has exactly:
`schema_version`, `status`, `reason`, `signal`, `limits`, `limitations`,
`targets`, `attempted`, `signaled`, `root_exit_code`,
`all_owned_exited`, `observers_closed`, `elapsed_seconds`.
schema_version=1; signal=SIGKILL; status not_run|failed|verified.
Reason null for not_run/verified; failed reason one of
ownership|identity|signal|deadline|survivor|observer|schema.
Limits exactly max_targets=64, shutdown_seconds=10, extension_bytes=49152.
Limitations exactly same_runner=true, same_path=true, same_uid=true,
public_committed_wait=true, sequential_signals=true, kernel_filesystem_alive=true,
observed_generations_only=true, unobserved_descendants="unknown",
power_loss_tested=false, in_flight_step_tested=false, external_exactly_once_tested=false.

Each target has exactly pid, pgid, start_ticks, signal_sent, exit_observed.
PID/PGID positive integer, start_ticks nonnegative integer, booleans strictly bool.
Unique PID/start generations; no concurrent duplicate PID. Root first. At most64.
Counts strict nonnegative integers, signaled equals true signal_sent count,
signaled≤attempted≤target count. Attempts form a deterministic target prefix and signal_sent=true entries form its successful prefix (a denied last attempt remains false); refuse any reordered true flags. Exit_observed means the original generation is absent, zombie or replaced on observation, never adoption of a reused PID. all_owned_exited is verified against the full retained authorized history, not only frozen-target flags. The helper checks target0 against owner.identity and the harness checks it against daemon_before before accepting M5-02. root_exit_code null or integer excluding bool;
elapsed finite nonnegative. verified requires at least2 targets, attempted=
signaled=target count, all target exit_observed=true, root_exit_code=-9,
all_owned_exited=true, observers_closed=true, reason=null and elapsed_seconds≤10. Failed requires non-null fixed reason; all_owned_exited=true requires every target exit_observed=true, and observers_closed=true implies no live observer. Unsignaled exits and over-deadline duration remain valid failed partial facts, never verified success. not_run has empty
targets, zero counts/time, null return code, false exit/closure flags. failed
does not grant restart even when some target flags show successful operations.

No additional fields/paths/argv/environment/raw stat/errors/private data can enter
this extension. Reject invalid fixed values, booleans as numbers, NaN/Infinity,
duplicate or inconsistent receipts and over-limit values. Serialize with
indent2/sort_keys/allow_nan=false; extension≤48KiB, then existing whole-report
128KiB bound and secret scan. Invalid projection revokes M5-05/result/evidence
success and falls back only to a valid not_run/failed receipt. Do not lose stdout
failure reporting because an untrusted extension is malformed.

Top-level `readback` contains exactly booleans instance_account_database_unchanged,
state_identity_unchanged, d1_row_unchanged, original_workflow_waiting,
read_only_http_enforced and strict integer read_requests in0..256. All flags strictly bool; reject extra keys/private strings/NaN/boolean counts. Initialize all flags false/count0; validated partial observations may set flags individually. A successful readback requires all true and at least6 completed GET requests (health/account/deployment/version/job/original Workflow; polling may add reads). A M5-specific GET-only client counts only requests that completed successfully and refuses request257 before network I/O; preserve M2 read_requests semantics. Projection/failure fallback independently validates crash and readback, revokes success for either malformed value and replaces only unvalidated readback with its all-false/zero initial value so bounded stdout failure survives. Record original
Workflow, state and numeric daemon controls through existing sanitized fields.
No backup package, resource metrics, storage inventory, R2 or credential hashes
are included. M5 errors use fixed crash reason codes; sanitized raw runtime logs
remain bounded by existing policy and do not create crash evidence.

## Budgets

Download is separate. Scenario300seconds starts before first daemon spawn.
Abrupt shutdown10seconds includes identity refresh, signals, polling/reap and
existing observer joins, clamped to scenario remaining time. HTTP20seconds total
is clamped to scenario and conservative Workflow cutoff. Workflow300second
cutoff begins before original creation and is never reset; approval must retain
20second margin, completion stays within remaining cutoff. Startup/polls/CLI
retain finite bounds under the main scenario alarm.
Separate cleanup150seconds; owned scope removal30seconds; evidence write10seconds.
Use the M4 opt-in bounded marker reader for M5 owner checks/removal; retain other
scenario defaults. Nested timers restore handlers and do not pause outer timers.
Application deadlines cannot guarantee interruption of uninterruptible kernel I/O.

## Acceptance and verification

| ID | Required observable result |
| --- | --- |
| M5-01 | Original pin/fresh non-root scope, real deployment/duplicate row, original publicly committed waiting Workflow and strict counter/nonce checkpoint. |
| M5-02 | Actual daemon-first per-generation SIGKILL stimulus, every frozen target signaled, root -9, retained observed history nonlive, observers closed without ownership error. |
| M5-03 | New daemon over same original authority, GET-only original identity/row/waiting Workflow comparison before any approval; no repair/reseed. |
| M5-04 | Original Workflow complete with counter1/nonce/output unchanged; restarted daemon graceful SIGTERM exit0, owned generations exited and bounded owned cleanup. |
| M5-05 | Strict bounded separate sanitized report, exact tested source/artifact/environment and explicit stimulus limits; exclusive evidence write after cleanup, original reports unchanged. |

Offline Red-Green-Refactor tests must include actual controlled parent and
separate-process-group child receiving SIGKILL and exiting. Failure boundaries:
no live child/root, stale/reused/zombie identity, unknown stat/owner observation,
signal denial/disappearance, normal root exit, survivor, observer/drain timeout,
target/deadline limits. Assert unrelated generations never receive signals.
Harness tests cover checkpoint shape/status/committed counter bool/0/2,
read-only refusal before network I/O, changed state/row/nonce/identity/workflow,
forbidden restart/approval after stimulus failure, expired Workflow cutoff,
unexpected already-dead final daemon, incomplete cleanup/changed marker,
evidence write/projection failures and sanitized numeric field injection.

Root owns docs/CI/Makefile and integration. Disjoint isolated writers own
crash.py/test_crash.py and lab.py/test_crash_integration.py, respectively.
Fresh independent SDD/source/raw runtime evidence review is required.
Commit reviewed SDD before code; root inspects every diff and reruns full suite.
Commands: make check; make integration-crash; python3 lab.py integration-crash,
with existing cache/output/port options. CI adds a fresh non-root Python3.11
checkpoint-crash job, 10minute timeout, existing immutable actions/read-only
permissions, only explicit sanitized report upload with7day retention.
M1–M4 runtime regressions stay required. No scope/config/key/raw data upload.

STATUS preserves the first successful original sanitized report bytes and links
its actual checkout/tree/CI/hash. Later validation reports do not rewrite that
source attribution. Final normal merge/content readback and review handoff end
this milestone; owner acceptance and any subsequent experiment remain separate.
