# SDD M5: SIGKILL at a publicly committed waiting checkpoint

Status: implementation contract; executed results belong in [STATUS.md](STATUS.md).
Created: 2026-10-15. Baseline main: `4db45139bac19d6ffc5f12c215a80faed51378da`.
Scope: this lab and its existing scoped CI. Extends M1 without changing M1–M4
contracts, original reports, fixture, cold backup semantics or artifact pin.

## M5 kernel owner amendment (T081, Phase A)

This amendment supersedes only the generic Process ownership/interface portions
below for `integration-crash`. It is a design freeze, not implementation or a
passing experiment. Required CI40109462879 failed at durable_wait with
observer/child_missing, before any target freeze or SIGKILL. The vanished
candidate generation/role is unknown. Identical generic Process/command/crash.py
source across the diagnosed bridge does not prove scheduling unaffected or
attribute the historical failure to M4. Preserve that failure and all reports.

### Isolation and explicit reuse decision

Add `crash_lifecycle.py`, selected only by `lab.main()` when command equals
`integration-crash`. Its `dispatch(args)` uses same-PID `os.execv` into a fresh
first-party Python runner, preserving direct-parent PID/exit attribution. It
installs checked Linux x86_64/glibc SIGCHLD default/SA_NOCLDWAIT-clear and child
subreaper policy, reads both back, and requires initial actual ECHILD before any
subprocess, scope or upstream work. Unsupported policy fails before launch.
The integration parent and host signal policy are untouched.

Use a separate M5 implementation of registered Popen/sole-waiter/reader/launch
guards, based on the reviewed M4 invariants but duplicated deliberately: importing
or changing storage_lifecycle would couple frozen M4 behavior to crash stimulus.
Do not extract shared owner infrastructure in this slice. Reuse lab's bounded
numeric process_info, public_process, HTTP/checkpoint/readback/owned-scope helpers
and unchanged crash.initial_crash/project_crash/initial_readback/project_readback.
Leave crash.abrupt_shutdown and generic Process/command byte-identical; M5 calls
its owner's actual abrupt path. No synthetic process/monitor/reader adapter.

`integration(..., lifecycle=None)` remains the entry signature. In crash mode it
requires the private M5 Runner, binds local command/source_commit/start/liveness/
abrupt/restart/finalize/delete calls explicitly; storage retains its existing
binding. A direct crash call without that owner refuses before subprocess/scope.
Every existing source identity/version/setup/CLI subprocess goes through the
registry, including source_commit during report initialization before preflight.
Owner entry handling encloses that initialization too: source_commit timeout or
authority failure must close launches, attempt bounded containment and emit the
safe preflight failure report rather than escape before cleanup/report handling.
No generic subprocess may precede Runner installation. The other command routes,
M4 proof/schema, fixture, artifact pin, deadlines and historical evidence stay
unchanged. Tests must assert dispatch and unchanged non-M5 source definitions.

### Concrete private API and authority objects

All owner operations run on the sole main thread. `Daemon` contains the real
registered Popen, immutable numeric root identity, bounded reader, log tail and
generation number; it exposes `identity` and `text()` for report use only.
Private frozen object identities are capabilities; dictionaries/public reports
are never capabilities. Objects bind owner identity, exact Daemon, generation,
scope path/marker/root identity and an immutable original monotonic deadline.
They have no public serialization, constructor admission or deadline renewal.

| API | Preconditions and result |
| --- | --- |
| `Runner()` | Fresh single-thread runner, checked policy and initial ECHILD; installs guarded registry before any child launch. |
| `command(argv, timeout=30, *, cwd=None)` | Open generation only; registered real Popen, finite main-thread wait and pipe drain, 32768-byte tail. Nonzero CLI is an ordinary workload failure after proven reap/drain; timeout/missing wait/drain latches authority failure. |
| `source_commit()` | Uses registered command with5s bound and lab source cwd; ordinary missing git/nonzero/invalid SHA returns null only after clean wait/drain; authority failure propagates. |
| `bind_scope(scope)` | Bind the newly created scope once, after bounded check_owner; mismatch forever revokes authority. Never adopt an old scope. |
| `start_daemon(argv)` | Only generation1 before freeze, or generation2 inside consume_restart; one daemon each, real registered Popen and exact live identity. |
| `sample_liveness(daemon)` | At most one source pre-checkpoint sample; returns stable numeric children and records incomplete ambiguities. Requires exact live root and at least one proven stable child for M5-01; grants no crash/closure/deletion authority. |
| `freeze_targets(daemon, *, deadline)` | Irreversibly closes generation1 launches before scan; strict complete bounded ownership admission, root first plus sorted live children,2..64 targets, full retained history. Returns private immutable FrozenTargets. Failure latches authority; no signal yet. |
| `abrupt_shutdown(daemon, *, deadline)` | Uses freeze_targets internally, actual root-first SIGKILL and exact-generation checks, registered root wait=-9, full-history nonlive, closed readers/pipes, checked policy and actual ECHILD, all within min(original scenario end, entry+10s). Returns `(public_crash, RestartReceipt)` only after all pass; raises CrashError with strict cached failed partial receipt otherwise. |
| `consume_restart(receipt, argv)` | Identity/scope/closed generation/no-latch/no-cancel/original deadline checked; mark consumed before opening generation2 and launching exact argv. Recheck deadline/policy/scope after launch. Returns real new Daemon; failed consumption cannot replay, even if launch succeeded. |
| `cancel()` | Permanently latches cancelled, closes launches and invalidates every capability; never labels interruption intentional crash. |
| `finalize(*, deadline)` | Adopts original separately yielded150s cleanup end once, closes launches, normally SIGTERM exact running final daemon, actual root exit0, no force, all registry waits/drains complete, retained history nonlive and fresh ECHILD/policy. Returns private DeletionSeal and sanitized final shutdown. With no daemon, closes registered pre-daemon commands and requires ECHILD. |
| `consume_deletion(seal, remove)` | Rechecks original bound/scope/policy/no threads/closed launches and fresh ECHILD; consumes before callback. Callback only existing bounded owned-scope removal, clamped to min(original cleanup end, entry+30s); check original bound after callback. Failure/overrun cannot grant removal success or mint another seal. |
| `contain(*, deadline)` | Bounded failure-only best effort: exact direct registered still-wait-owned roots, and previously authorized live identities after fresh exact read, may be stopped. Never signal an unknown/reused generation, fabricate wait status, clear latch, restart or authorize deletion. Record incomplete containment separately. |
| `evidence(*, complete=False)` | Rebuild through the strict additive projector below. complete requires both successful generation closures, consumed restart, final cleanup/removal and no failure. |

RestartReceipt stores the original crash cutoff; scope checking and launch
consumption occur before it expires and recheck it afterward. DeletionSeal stores
the original cleanup end; a caller-supplied later deadline cannot extend either.
No seal/receipt can be reused, exchanged across owners/generations, reconstructed
from a projected verified dictionary, or consumed following cancellation. An
ordinary workload/assertion failure preserves a failed scenario, yet permits
fresh normal cleanup/deletion if no authority latch exists. A crash/identity/
wait/policy/launch/drain/limit/cancellation failure forbids both restart and
deletion, even if later containment observes every process dead. No scope means
no deletion capability; pre-daemon CLI failure still closes the launch registry.

### State machine and sole kernel waiter

`BOOT -> SOURCE_OPEN -> FREEZING -> SIGNALING -> CRASH_CLOSING -> CRASH_CLOSED
-> RESTART_CONSUMING -> RESTARTED_OPEN -> FINAL_CLOSING -> FINAL_CLOSED
-> DELETING -> REMOVED`. Any authority violation enters irreversible REFUSED;
only containment/reporting remain. Ordinary workload failure transitions from
either open state to FINAL_CLOSING with result still failed. Before restart,
CRASH_CLOSED can finalize without a second daemon only to dispose a failed
ordinary scenario; it does not manufacture final normal-exit0 success. Successful
M5-04 requires generation2's actual running SIGTERM/exit0 path. ROOT0, early root
death or a forced final stop never substitutes for crash root-9/final root0.

Guard subprocess launches, os.fork/forkpty/posix_spawn and waits in the fresh
runner; strong Popen registry references survive all checks. Launches outside
owner-authorized Popen creation, closed gates, concurrent/reentrant launch and
competing or non-main-thread waits latch refusal. Never accept Popen's fallback
exit0 on ECHILD. Only main-thread registered root waits collect those statuses;
then the main thread uses waitid(P_ALL,WEXITED|WNOHANG|WNOWAIT) and exact waitpid
to reap adopted exits. Zero WNOHANG, zombie/absent /proc, pidfd readiness or empty
process group is insufficient: closure requires actual errno.ECHILD after all
registered waits, bounded pipes/readers and policy checks. Any stolen status,
policy mutation, thread/launch after closure or live unknown adopted descendant
refuses closure. Anonymous adopted exits are counted, never retroactively
counted as authorized crash targets or actual signals.

Only registered output readers and bounded existing HTTP timer threads are
admitted; no background ownership observer or waiter. Readers use32768-byte
tail rings and never reap. Join each within min(2s, original operation remaining),
no reader/thread may survive closure. Guard thread starts after launch closure.
Kernel policy is checked at admission, stimulus, closure and capability use.

### Incomplete sample versus strict crash admission

Sample at most8192 numeric /proc entries; retain at most1024 authorized PID/start
generations and1024 edge events. Stable admission needs two current parent/child
reads proving exact parent/child generations, parent link and start order.
Pre-checkpoint candidate missing/reused/reparented/zombie observations are bounded
incomplete sample facts; omit that candidate and its unproved subtree, without
claiming whole-tree closure or suppressing a missing required stable child.
Unparseable/unreadable stat, scan/history/event overflow, root change or
contradiction to an already admitted generation remains authority failure.

The final freeze performs its own fresh complete bounded scan and strict edge
validation. Any ambiguous candidate then fails before signals, even when a
stable child exists. Previously proven retained descendants stay retained until
freshly observed nonlive; never erase history after reparenting. A retained live
generation reparented to the checked runner may remain authorized only by its
earlier proven root descent and exact generation, never by PPID alone. A new live
runner child outside the registered direct set/retained descendant set is
unknown, blocking freeze/closure; no blind signal/adoption. Post-freeze live
discoveries cannot expand or replace targets. They block verified crash, and
may only exit naturally or be contained if already exact-authorized. Unknown
short-lived adopted exits may be reaped for ECHILD, but do not fill missing
frozen target signal flags. All retained authorized history is checked nonlive
after root wait and drains; fresh ECHILD adds an independent whole-child barrier.

Freeze re-reads EVERY retained authorized generation, including those outside
the current root-descendant scan. The frozen set equals the union of all exact
freshly live retained generations and all freshly strictly admitted descendants,
plus the root. Missing/zombie/reused retained originals are nonlive facts only;
unreadable/unknown identity fails. Thus an exact retained live reparented child
MUST appear in targets and receive its own SIGKILL, or the freeze/stimulus fails;
its later natural exit and ECHILD cannot substitute. Apply64-target bound to this
entire union before any signal, with no truncation or concurrent duplicate PID.

The new abrupt path reproduces every existing crash helper boundary: cutoff
checks before/after reads and operations; frozen real root equals daemon_before;
root-first deterministic actual SIGKILL; freshly read exact PID/start/non-zombie
before EACH signal; no kill-by-name/group, ESRCH success or parent-loss credit;
attempted/signaled prefix semantics; root actual wait-9; every frozen generation
exit_observed and full retained history nonlive; reader closure before verified.
Late vanished/zombie/reused/unsignaled targets fail even if ECHILD follows. On
exception, retain only facts completed before failure; no post-deadline read,
signal, wait or diagnostic enrichment. Failed partial stimulus never restarts or
approves; strict existing project_crash accepts cached receipt or sanitized
failed/schema fallback. Its original limitations,64 targets and48KiB remain.

### Strict additive public schema

Add only top-level `crash_lifecycle`, absent from every non-M5 report. Preserve
existing crash v1, readback, final_shutdown and diagnostic sidecar schemas.
`initial()`/`project(value, *, complete=False)` rebuild exact local dictionaries.
`project_report(value, *, crash_receipt, daemon_before, daemon_after,
final_shutdown, scope_removed, complete=False)` first invokes project and the
existing crash projector, then checks the cross-extension relationships below;
absent observations are passed as null, never fabricated. Harness uses this
contextual projector before every output/success decision. All
enums are fixed, booleans strict, integers exclude bool and lie in0..2**63-1
unless smaller below. Reject extra keys/private strings, NaN/Infinity, invalid
prefixes and inconsistent proof relationships. Extension serializes with
indent2/sort_keys/allow_nan=false and is<=16384 bytes; whole report<=128KiB and
existing secret scan remain. No deadlines/tokens/scope IDs/paths/argv/raw errors.

Top-level exact keys: `schema_version`=1, `mode`="m5-kernel-owner",
`failure`=null or reason enum below, `sampling`, `generations`, `restart`,
`cleanup`, `containment`, `limits`. Limits exact: targets64, proc_entries8192,
history1024, launches1024, adopted_reaped1024, edge_events1024, threads16,
tail_bytes32768, extension_bytes16384. These are whole-run incremental bounds;
generation launch/adoption counters sum to at most their whole-run limit.

`sampling` exact keys: `attempted` integer0..1, `stable_children`0..1024,
`ambiguous_edges`0..1024, `reasons` exact counters for parent_missing,
parent_zombie,parent_reused,child_missing,child_reused,child_reparented,
child_zombie,start_order; their sum equals ambiguous_edges. All zero initially;
attempted0 implies every counter zero. It never contains a closure/pass flag.

`generations` ordered prefix of at most2 exact records: `index`1|2 matching
position, `root` null or exact positive pid/pgid/nonnegative start_ticks,
`launches`,`waited`0..1024, `pipes_open`0..3072, `threads_open`0..16,
`adopted_reaped`0..1024, `launches_closed` bool,
`closure_kind` not_run|crash|normal|commands, `root_exit_code` null or signed
integer in-255..255, `history_nonlive`,`drains_closed`,`kernel_echild`,`closed`
bools, `failure` nullable reason. waited<=launches. Root nonnull requires at
least1 launch. closed implies launches_closed, waited=launches, zero open
pipes/threads, drains_closed/history_nonlive/kernel_echild true and no failure.
closure_kind starts not_run; closed requires a non-not_run value. crash is
allowed only for generation1 with crash.status=verified and exit-9. normal
requires final_shutdown.was_running=true, SIGTERM, forced=false, exit0; it can
close generation1 on ordinary pre-stimulus failure, or generation2 normally.
Generation1 normal closure never satisfies M5-02/04. commands requires null root
and exit code. Closed restarted root requires kind normal.
No-root closed records are allowed only on failed pre-daemon cleanup and cannot
satisfy M5-02/04. Generation2 exists only after restart consumed; root2 must
differ from root1. Contextual projector validates root1=daemon_before=
crash.targets[0] when crash targets exist, root2=daemon_after and actual exit
codes. No daemon_before is required for failed pre-checkpoint normal cleanup;
when present it must equal root1. complete requires source crash closure and
generation2 normal closure, consumed restart, removed cleanup and no failure.

`restart` exact: `status` not_run|issued|consumed|refused, `reason` nullable
enum. issued/consumed require closed source generation, crash verified, no
failure and null reason; consumed grants only generation2 admission. A later
failure preserves consumed as historical fact, with top-level failure latched;
therefore no-failure is required when issued/consumed FIRST occurs and complete
projection requires it still null. refused requires reason; not_run null reason.
Projected historical consumed is never an executable capability.

`cleanup` exact: `status` not_run|verified|removed|refused, `reason` nullable
enum, `kernel_echild` bool. not_run has false/null; verified/removed require
final closed record, fresh actual ECHILD and null reason; verified requires no
authority failure. removed additionally requires existing scope_removed=true
and no authority failure before removal. Later evidence/projection failure
cannot undo actual removal: preserve historical removed/null reason/ECHILD and
scope_removed=true with the separate later failure, revoking result/M5-05.
refused requires reason and cannot permit scope_removed=true. `containment` exact: `attempted`
bool, `complete` bool, `reason` nullable enum; complete means bounded registered/
authorized containment observations completed, never closure/deletion authority;
not attempted implies complete=false/reason=null. Complete attempt has null
reason; incomplete attempt has reason.

Reason enum exactly unsupported|policy|launch|wait|identity|sampling|limit|output|
deadline|cancelled|receipt|root_exit|forced|unknown_child|crash|scope|schema.
First authority failure is immutable; original workload, crash receipt, cleanup
and evidence-write errors retain their separate existing channels. Invalid
lifecycle projection revokes result/M5-05 and rebuilds only independently
validated local records/cached owner facts, otherwise initial schema-failed
extension. A separately validated completed removal remains a historical removed
cleanup in this fallback, with scope_removed=true; it grants no capability.
That retained cleanup requires its independently validated closed-generation
records as well. If those cannot be validated, use initial schema-failed extension
with cleanup not_run and preserve independently validated scope_removed as a
separate historical report fact. Failed projection permits that incomplete
pair; complete projection never does. Never replace actual removed with refused.
Independently valid crash/readback facts survive. Entry refusal
before validated output paths emits only bounded stdout, all M5 gates not_run,
runtime_started=false and evidence_file_written=false; no arbitrary sidecar I/O.

### Red-Green and qualification release plan

Phase A permits only this contract, SUCCESS/SDD index/task and private report;
root must obtain independent design review, inspect exact doc diff and commit
the reviewed contract before explicit Phase B release. No implementation,
runtime, CI retry or M4 edits are authorized by this document alone.

1. Causal RED: isolated actual stable daemon child plus synchronized transient
   helper exits between discovery and candidate validation. Original generic
   Process reproduces child_missing refusal unchanged. New M5 incomplete sample
   retains that reason/count, proves stable child, grants no authority. GREEN
   then uses a NEW independently strict clean freeze, actual root-first SIGKILL
   of root plus separate-group stable child, real root-9, complete history,
   drains and ECHILD, capability-bound restart, final root0 and owned removal.
   Synchronize with private finite pipes/barriers, never timing-only sleeps or
   arbitrary process names. Fixture controls only synthetic children.
2. Adversarial RED/GREEN: same disappearance DURING final freeze rejects before
   any signal; child vanishes/zombies/reuses after root kill fails partial signal
   receipt; actual live/double-fork adopted child blocks ECHILD; unknown adopted
   live child receives no signal; delayed unknown exit cannot repair missed
   target SIGKILL; retained live reparented child omitted from root scan must
   still be frozen/signaled (or fail), and retained live orphan blocks; root0 cannot pass crash; failed
   stimulus forbids restart/approval/removal. Cover every fixed original crash
   boundary, count/scan/history limits, malformed identities and unrelated PID.
3. Actual-process guards: source_commit/version/setup are registered even when
   pre-daemon CLI fails; clean CLI-nonzero/workload assertion permits fresh
   cleanup with failed result; lost wait status/policy/cancel/late launch/thread/
   drain failure forbids capabilities. Actual receipt expiry before consumption,
   launch crossing expiry, replay/cross-owner/forged dict and deletion callback
   expiry/overrun refuse. Record original deadlines rather than reset test time.
4. Schema adversaries: bool counts, extra/private fields, wrong prefixes/cross-
   extension root/status, contradictory ECHILD/counts/flags, huge/NaN fields,
   invalid initial/partial/complete values, safe fallback preserving valid crash
   facts and stdout. Existing GET-only original identity/row/nonce/Workflow,
   request257/no reseed, final0 and10/300/150/30/20s controls remain tested.
5. Each process fixture runs in its own finite subprocess from shared-launcher
   task dirs, with bounded stdout/deadline and exact fixture cleanup; run owner
   policy changes only there. Use verified Python3.11 SDK with PYTHONPATH absent.
   Preserve failing RED evidence before edits, then focused GREEN. At most two
   evidence-based revisions per defect before root revisits design.
6. Freeze exact source hashes; independent owner/crash/adversarial review and
   root full offline make check on that freeze; unchanged M4/generic dispatch
   regression evidence. Only after explicit root runtime release, one original
   pinned-artifact M5 fresh non-root qualification with strict report/raw evidence
   review and unchanged workload/artifact hashes. A failure is diagnosed before
   any repeat. Full required CI/exact-head review and normal PR delivery remain
   root gates. M4 evidence never substitutes for M5 crash proof; no usable,
   deployment, historical attribution or mainline-completion claim follows here.

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
