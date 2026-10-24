# SDD M4: bounded cold disk footprint and fixed D1 writes

Status: proposed implementation contract; executed evidence belongs in STATUS.md.
Baseline: main 7e854f26ef66dd8e0aa6583011ef65ed35951ad7. Extends M1; M1/M2/M3 historical contracts and reports remain intact.

## Outcome and selection

Add `integration-storage` on the unchanged original open-compute v0.2.4 pin. Record three cold metadata snapshots of the entire run-owned scope around a fixed small D1 batch and original Workflow completion. The outcome is reproducible endpoint observations with explicit coverage, not a storage quota or adoption approval.

M2 measures backup payload under its precise exclusions; M3 observes process RSS/CPU. Neither measures total regular-file allocation including generated OCR and transient content. D1 uses the existing trusted fixture, bounded routes and payload ceiling. It is the smaller next experiment than new R2 routes, crash recovery, upgrades or an adapter. The differences mix restart, platform background state, fixed writes and completion; they cannot be attributed exclusively to row payloads. Do not divide them into per-job cost or infer a growth rate.

No fixture, upstream pin, cold backup semantics, host adapter, dependency, service, user, external storage, cloud resource, release or deployment change. No disk filling, arbitrary load, delete/reclamation, compaction, crash or long-running soak. Preserve M1/M2/M3 as independent regression scenarios.

## Fixed scenario

1. Fresh disposable non-root Linux x64 runner, original verified release, existing Worker/D1/Workflow deployment. Preserve duplicate original submission, one original row, committed callback counter 1, nonce and original Workflow waiting.
2. Normally stop the first daemon. Require exit code 0, no force or observation error and all lifecycle-owned generations exited. Check original scope ownership; acquire three existing exclusive nonblocking locks. Snapshot `cold_baseline` while locked, then release all locks before restart.
3. Restart the same scope, instance/config/data/database identities and original row/Workflow. Submit exactly 16 additional unique jobs with deterministic IDs `disk-00` through `disk-15`, each payload exactly 128 ASCII `x` characters. Submit each twice serially, require identical responses, row_count strictly integer 1, exact ID/payload, callback_count 0, step_nonce null and completed 0. No extra Workflow is created. Before submission, GET each ID must produce the fixture's missing-job response; existing rows fail the experiment.
4. Stop the second daemon gracefully and snapshot `cold_after_writes` under the same locks and ownership checks. Release locks. Restart the same authority again, read all 16 original batch rows before any workload write, require byte-equivalent canonical JSON rows and row_count 1. Verify original Workflow still waiting, original row/counter/nonce unchanged. Approval uses only the original Workflow ID and its persisted five-minute deadline.
5. Approve and complete the original Workflow; require existing resume invariants. Normally stop the third daemon; snapshot `cold_after_completion`. After locks are released and all processes exited, perform bounded owned cleanup. Only complete cleanup and a successfully written strict sanitized report grant success.

The fixed workload extension has `jobs=16`, `payload_bytes_per_job=128`, `unique_payload_bytes=2048`, `submission_attempted/completed=32`, `absence_checks_attempted/completed=16`, `retained_reads_attempted/completed=16`. Track attempted and completed operations separately, validate exact counts on success. Missing-job GET is an explicit expected HTTP404 containing `{job:null,row_count:0}`, not a swallowed transport/error response. Keep LocalHTTP's historical successful response behavior unchanged; add a narrow expected-status option if needed, still with bounded body and deadlines. Any wrong state or operation failure prevents later workload/approval and triggers owned cleanup.

## Snapshot authority and I/O

A new standard-library `storage.py` observes metadata only. Freeze the integration API: `StorageError` exposes only fixed reason; `PHASE_NAMES`, `GROUP_NAMES`, `initial_workload()` returns a fresh full workload dictionary with zero operation counts; `cold_snapshot(scope, phase, *, deadline)` returns strict snapshot or raises; `project_snapshot(value)` validates/rebuilds one snapshot; `storage_extension(snapshots, workload)` and `project_storage(value)` validate full success including recomputed signed deltas; `partial_extension(snapshots, workload)` validates the fixed prefix subset failure projection. No implicit test-only protocol flags or arbitrary paths. Interface `cold_snapshot(scope, phase, *, deadline)` consumes the harness-owned scope object (path, recorded device/inode, expected marker bytes), fixed phase name and absolute monotonic deadline. The caller alone authorizes verified process exit and cleanup. The helper never signals runtime processes, writes/reseeds authority, copies/hashes payload bytes, reconstructs state or grants deletion authority.

Acquire existing lock files `ocd.lock`, `instances/lab/data/platform.lock`, `instances/lab/data/objects/backend.lock` with O_NOFOLLOW/nonblocking opens and LOCK_EX|LOCK_NB. Never create missing locks. Validate ancestor directories by descriptor, no symlink, current UID, same device, safe modes; lock leaf must be regular, link count 1 and match before/open/final identity. A held/unsafe/missing/replaced lock fails. Hold descriptors through metadata traversal and final ownership/lock recheck; always close/release only owned descriptors. Do not instantiate M2 recovery objects or alter its archive rules.

Open the owned root with O_DIRECTORY|O_NOFOLLOW and match its recorded device/inode. Traverse using directory descriptors and no-follow stat/open operations, never following symlinks or another device. Every entry must be owned by current UID, have no special permission bits or group/other write permission. Symlinks, FIFO, devices and unsupported types fail. Socket entries may be counted only under the two exact transient groups below; elsewhere they fail. Root marker is checked before/after by descriptor-relative O_NOFOLLOW|O_NONBLOCK open: regular current-UID file, nlink1, safe0600 mode, exactly64 lowercase ASCII hex bytes matching scope.marker, read at most65 bytes and compare fstat before/after. No OwnedScope.check_owner unbounded read is used by the scanner. For M4 harness ownership/cleanup boundaries, add an opt-in bounded marker validation path without changing M1/M2/M3 defaults. The exact harness-owned marker is the only excluded entry. Runtime locks and all other files count.

For directories, record starting and ending device/inode/mode/UID/mtime_ns/ctime_ns; changes fail. For regular files, validate metadata twice (including device/inode, mode/UID, size, st_blocks, nlink, mtime_ns/ctime_ns); changes or unreadable/disappearing entries fail. Metadata is sequential, not an atomic filesystem snapshot or hostile same-UID protection. Same-device traversal is enforced; bind mounts sharing a device are outside what this metadata proves and remain unknown. No full inventory/path/stat/error strings enter public evidence.

Finite constants: 8192 entries including directories/sockets, depth 32 beneath scope, 512 UTF-8 bytes per relative path, 512 MiB apparent size per regular file, 2 GiB total unique regular apparent bytes and 2 GiB reported allocated bytes. Check limits incrementally before unbounded discovery/materialization. Each cold snapshot has a 10-second main-thread deadline clamped to outer scenario budget. Deadline checks cover lock/traversal/recheck; SIGALRM restores prior handlers/timers. Interrupt/unknown I/O cannot yield a partial passing snapshot. These application deadlines do not promise to interrupt uninterruptible kernel filesystem I/O. No observer/helper subprocess is required; use existing main-thread watchdog and bounded descriptor traversal.

## Counting semantics and groups

Counters count regular-file metadata only. `logical_bytes` sums st_size once per (device,inode); `allocated_bytes` sums st_blocks × recorded unit 512 once per inode. Directory and socket counts are separate; their sizes/blocks are excluded. `regular_paths` counts all regular-file names; `unique_files` counts inodes; `hardlink_aliases=regular_paths-unique_files`. Equal-size separate files count separately. For each inode, all aliases must share validated metadata and fixed group; cross-group aliases fail. Report nlink aliases observed, not an assertion that every external link was found. Hard links are observed only for M4 accounting; M2 persistent import still refuses them.

Every included path belongs to exactly one fixed group, using explicit path-prefix priority:

| Public enum | Internal scope-relative partition |
| --- | --- |
| scope_transient | cache, tmp, run subtrees |
| instance_transient | instances/lab/data/cache, tmp, runtime subtrees |
| derived_tessdata | instances/lab/data/tessdata subtree |
| local_objects | instances/lab/data/objects subtree (except prior explicit groups) |
| instance_other | remaining instances/lab/data subtree |
| scope_other | everything else |

Directory counts include each group's subtree roots; the scope root belongs to scope_other. Lock/key/config files count in their partition. Zero-valued groups are real completed observations, never substitutes for inaccessible entries. All group metrics must sum to totals. Keep source/evidence/cache/private backup outside the measured scope; they are not disk footprint of this scope. Do not use M2 exclusions for total-footprint accounting.

The immutable `limits` object has exactly `max_entries=8192`, `max_depth=32`, `max_path_bytes=512`, `max_file_logical_bytes=536870912`, `max_total_logical_bytes=2147483648`, `max_total_allocated_bytes=2147483648`, `snapshot_seconds=10`, `extension_bytes=49152`. The immutable `limitations` object has exactly `regular_files_only=true`, `directory_socket_blocks_excluded=true`, `observed_hardlinks_deduplicated=true`, `sequential_metadata=true`, `cold_cooperating_runtime=true`, `physical_extent_allocation="unknown"`, `same_device_bind_mount_coverage="unknown"`, `filesystem_allocation_policy="unknown"`, `peak_growth_rate_capacity_retention_tested=false`. These are fixed booleans/enums, not free text.

The public storage extension has exactly `schema_version` (1), `units` (`allocated_block_bytes=512`), `limits` (fixed constants), `limitations` (fixed fields), `workload` (fixed fields/counts above), `snapshots` (three fixed names) and `deltas` (two fixed names). Each snapshot has exactly `phase`, `elapsed_seconds`, `entries`, `totals`, `groups`; totals/groups contain exactly `logical_bytes`, `allocated_bytes`, `regular_paths`, `unique_files`, `hardlink_aliases`, `directories`, `sockets`. Numeric counters strictly nonnegative integers excluding booleans, elapsed time finite nonnegative. Enforce count relationships, entries equal regular_paths+directories+sockets, aggregate limits and exact group sums. Fixed delta names `writes_minus_baseline` and `completion_minus_writes` contain signed integer differences for all seven metrics, recomputed from snapshots; zero and negative values remain valid. Never clamp or wrap signed changes.

Projection rejects extra keys, wrong enums, booleans, NaN/Infinity, incompatible totals, forged delta/counts and path/string/credential injection. Partial evidence is `storage_partial`, exactly `schema_version`, `units`, `limits`, `limitations`, `workload`, `snapshots`, with identical fixed values to the successful extension. `snapshots` permits only a prefix subset of the three fixed names (including empty); never include failed scans. No deltas appear in partial evidence. Workload always includes all nine fields above: jobs/payload_bytes_per_job/unique_payload_bytes fixed16/128/2048, each attempted/completed pair nonnegative integer with completed≤attempted≤its fixed required count. Full success requires all six counters exactly32/32/16/16/16/16 and all three snapshots. Partial evidence is emitted on failure even before the first snapshot; a success has only `storage`, never both. No failed/partial scan metrics. Store no raw exceptions in the extension. Generic harness errors use fixed storage reason codes (`ownership`, `lock`, `type`, `metadata`, `limit`, `deadline`, `schema`); report diagnostics through existing redaction with no storage path/OS text. Extension serialization uses indent=2/sort_keys=True/allow_nan=False and is bounded to 48 KiB before whole-report secret/size scan.

Fixed limitations: regular files only, directory/socket blocks excluded, observed hardlinks deduplicated, extent sharing/reflinks/compression/physical media allocation unknown, sequential metadata, cold cooperating-runtime scope, same-device/bind-mount coverage unknown, no peak/time-series/full-host/free-space/I/O-throughput/capacity/retention conclusion. No filesystem path, device/mount name or key/content digest is public. Existing numeric state/process device/inode identities and original synthetic nonce digest remain in the unchanged M1 functional evidence; the prohibition applies to storage metadata paths/names/content and secret hashes, not those existing numeric identity controls. Report filesystem allocation policy as unknown rather than guessing a type.

## Budgets and cleanup

Scenario budget: 300 seconds before first daemon spawn; download stays separate. Snapshot 10 seconds, HTTP remains existing 20-second total deadline clamped to scenario where needed, and all polls/CLI calls remain bounded. Original Workflow five-minute deadline never resets; use the existing conservative monotonic300-second cutoff recorded before creation as a local bound (not the upstream persisted timestamp). Verify approval margin and final completion against that cutoff; do not claim to inspect/reset the persisted timeout. Cleanup separate 150 seconds, scope deletion nested 30 seconds. Any unknown process, ownership mismatch, forced shutdown, lock-release error or incomplete cleanup fails M4 and prevents unsafe scope removal. No prior scope is adopted/deleted. M4 final shutdown is recorded before snapshot; cleanup must accept an intentionally already-gracefully-stopped final daemon without pretending an unexpected daemon exit passed.

## Acceptance

| ID | Required observable result |
| --- | --- |
| M4-01 | Exact original pin, fresh non-root scope, actual trusted deployment, duplicate original row and committed original waiting Workflow. |
| M4-02 | Three complete bounded cold metadata snapshots after graceful owned exits and exclusive locks, strict units/schema/group sums/hardlink accounting; meaningful negative tests. |
| M4-03 | Exactly 16 new fixed jobs, 32 identical submissions, 16 absence checks, 16 readbacks after second restart; validated original authority/state and signed endpoint deltas. |
| M4-04 | Original Workflow/counter/nonce completion, three normal daemon shutdowns, verified process exit and bounded scope cleanup. |
| M4-05 | Separate bounded strict sanitized report with exact tested source/artifact/environment, fixed workload/coverage/limitations; evidence write succeeds; historical evidence unchanged. |

All start not_run. Real original runtime is required for 01/02/03/04/05; fixtures validate harness boundaries only. Do not claim fresh adoption, capacity or exclusively D1 storage effects from one batch.

## Verification and delivery

Review and commit this SDD before code after a published task claim. Bounded writers: storage metadata/locks/projection/tests; sequential harness/CLI/integration tests; root owns docs/Makefile/CI and integration. Fresh source review and runtime evidence review are independent of builders. Root inspects every diff and reruns full offline checks via shared launcher.

Meaningful tests: sparse vs allocated files, equal-size distinct inodes and hardlink deduplication/cross-group refusal; included OCR versus M2 exclusions; lock contention/replacement/no creation; symlink/special/foreign UID/device/mode; root/marker mutation; changing/disappearing entry; depth/entries/path/bytes/deadline bounds; FD/lock release on every failure; strict field injection/numeric consistency/signed deltas; exact batch, expected404, wrong/retained row, expired workflow, all three cold checkpoints and no approval after failure; final stopped-daemon handling, cleanup/scope ownership/evidence failures.

Commands: `make check`, `make integration-storage`, CLI `python3 lab.py integration-storage`, existing cache/output/port options. Scoped CI adds M4 on a separate fresh non-root job with Python3.11 and 10-minute job timeout, same immutable action pins/read-only permissions and only one explicitly selected sanitized report artifact retained seven days. Existing M1/M2/M3 job remains required. No cache/payload/inventory/database/config/key upload. Use ephemeral CI rather than a persistent authoring home for real runtime.

STATUS links SDD-before-code, reviewed implementation, actual checkout/tree/CI/report hashes and measured figures only after successful real execution. Keep the original report bytes rather than attributing observations to later documentation commits. Authorized delivery ends with normal PR merge, remote readback and ledger review; owner done/release/deploy remain separate.

Primary measurement input: [Python3.11 os.stat_result documentation](https://docs.python.org/3.11/library/os.html#os.stat_result), inspected2026-10-13, defines st_size and512-byte st_blocks; this source explains units and is not runtime evidence.

## M4 kernel closure amendment (T077)

Status: proposed contract baseline; root reviews and commits before production or
test edits. This section supersedes M4's generic sampled-ownership prerequisites
only where explicitly described. All fixed workload, source authority, filesystem
locks/accounting, deadlines, acceptance and historical evidence remain intact.
The historical failed generation/reason/timing cannot be reconstructed.

### Entry, ownership and waits

The existing integration-storage command dispatches with same-PID os.exec into
new first-party storage_lifecycle.py before workload. No proxy daemon PID, parent
IPC or trial state protocol is introduced. Imports/argument parsing before exec
must not launch subprocesses. In the new interpreter, require main thread only,
matching PID/proc namespace, supported Linux x86_64/glibc ABI, reset/read back
default SIGCHLD with SA_NOCLDWAIT clear, set/read back child-subreaper, and require
initial actual ECHILD. Unsupported policy refuses before upstream/scope creation.
Only this disposable interpreter changes its own policy; no host settings change.

Install a bounded main-thread Popen launch/wait registry before calling integration
or source_commit. It covers git rev-parse (existing5s), artifact version (30s),
setup (90s), all other CLIs (30s) and daemon roots. No subprocess occurs in an
unregistered gap, including report source identity. Direct source_commit's existing
fallback to null source identity remains allowed for an ordinary git failure;
only git nonzero/unavailable may use that fallback. It must not swallow a
lifecycle timeout, forced containment, registry/policy/cancellation or other
authority failure, even if the helper catches a subprocess exception. A fixed runner check
after that helper prevents such uncertainty from being hidden. Bootstrap/version
failure is reported without opening a daemon or inventing its identity.

Use explicit M4 owner/command/sample/checkpoint/finalize APIs. Generic Process and
command remain byte-for-byte unchanged and are never used as fake M4 adapters.
Register direct Popen objects even when later construction/identity setup fails;
retain actual root PID/PGID/start and actual wait status. Reject unregistered
fork/spawn, background/concurrent launch or wait, and launches after epoch closure;
set sticky authority failure before raising. All runtime execs close inherited
nonessential descriptors. The only waiter is the runner main thread. Reader
threads read bounded rings, never poll/wait/spawn, and close only their own pipe.
Never let P_ALL collection steal an outstanding Popen wait: every registered
direct wait and all stdin/stdout/stderr closure precede adopted-child collection.

### Epoch transitions and failure authority

Epochs1/2/3 correspond exactly to cold_baseline/cold_after_writes/
cold_after_completion. Epoch1 includes git/version/bootstrap and daemon1; each
later epoch contains its own daemon/CLI work. Closing permanently disables that
epoch token. Stop the exact still-running direct daemon normally; an unexpected
early/nonzero exit or forced kill fails M4 even if the tree later closes. Existing
30s grace/finite containment apply; signals never target a PID merely sampled or
newly discovered/adopted. A live adopted child is waited for within the current
deadline, never blindly signaled. Unknown survivors prevent verified closure.

Before issuing a closure receipt: finish registered direct waits, require their
pipes closed, join every reader/other thread (max2s each, clamped to current
deadline), recheck SIGCHLD/subreaper/namespace, then drain adopted exits with
waitid(P_ALL,WEXITED|WNOHANG|WNOWAIT) and waitpid on that pinned child. WNOHANG zero
means live children, not completion. Only actual ECHILD proves tree closure.
Enforce bounds incrementally. Policy drift, identity/read/pipe/wait uncertainty,
late launch, cancellation, bounds or deadline failure is sticky; later ECHILD
cannot restore authority. Signals may contain an exact direct child but never
grant a passing receipt or deletion after force.

A private immutable receipt binds run identity, epoch/token, registered roots and
actual statuses, completed waits/drains, original absolute deadline and ECHILD.
Snapshot consumption/completion and next-epoch creation check that unchanged
deadline; no receipt use renews it. It is not reconstructed from
public JSON. Consume it once immediately before that epoch's cold snapshot.
No next epoch until snapshot success, verified lock release and receipt consumed;
old tokens never reopen. Snapshot/lock failure cannot resume workload or approve
Workflow. At final cleanup, recheck closed launches, all waits/drains, policy and
actual ECHILD to obtain fresh deletion authority; a previous snapshot receipt
alone is insufficient. Issue a distinct private single-use terminal seal after
this fresh check; consume it once at deletion, including failure cleanup before
daemon creation or after an already consumed snapshot receipt. It never reopens
an epoch or converts a failed run to success. The owner-owned
consume_deletion(seal,remove) verifies exact seal/run identity, unspent state,
closed epochs, current cancellation/authority/policy, scope binding and the seal's
immutable original absolute deadline, then marks
the seal spent at the deletion authorization linearization point. It immediately
invokes the existing bounded owned removal callback, with no intervening work or
new launch, under the original remaining bound. An expired seal never invokes the
callback. Cancellation or uncertainty before that point forbids removal;
interruption during removal fails the operation and preserves unfinished state
without claiming rollback of already completed filesystem changes. No subprocess
or new thread may launch after final close,
including source identity/evidence helpers. Final output writing remains bounded
and grants no success if it fails.

An ordinary workload/HTTP/schema/storage-metadata failure may perform existing
owned scope cleanup only if fresh kernel proof and marker/device/inode authority
pass. Authority/cancellation/identity/policy/unknown-live/force/lock-release
failure forbids any later snapshot or scope removal. An epoch without a launched
daemon may close for failure cleanup without claiming a normal daemon shutdown.
Scope-not-created failure needs no deletion authority; failed-start after scope
creation must register/reap the exact direct child and otherwise preserve scope.
An intentionally closed final daemon is not an unexpected early exit.

The unchanged scanner exposes no lock-release receipt on an exception. The
implementation therefore preserves scope after scanner exceptions; it does not
infer release merely from StorageError(metadata/deadline). Normal scanner return
establishes release, and all later snapshot projection/phase/owner checks must
also pass before snapshot_complete becomes true. Ordinary workload failures
outside scanning may still clean under a fresh terminal seal.

Keep300s scenario budget before daemon1, original Workflow cutoff, existing CLI
and HTTP deadlines,10s snapshots,150s final cleanup and30s removal. Registry setup,
sampling, waits and drains cannot renew these bounds. No retry/sleep workaround.
Cancellation is sticky and checked before closure consumption, snapshot, epoch
creation and deletion; interruption during those operations cannot grant success.
The existing SIGINT/SIGTERM handler must mark M4 cancellation before raising its
LabError, so finally cannot treat interruption as an ordinary workload failure.
Use typed lifecycle failures with a sticky first fixed cause; do not classify
authority from exception text or reset it after a successful later wait. Unknown
ownership exceptions are terminal authority failure. Ordinary workload/storage
exceptions are distinct from this latch. Sampling transient classification also
requires the original root identity and signal/subreaper policy to remain valid.

Explicit internal API: dispatch(args) performs fresh exec; Runner initializes
kernel policy/registry before lab.integration(args,storage=True,lifecycle=runner).
Runner.command(argv,timeout), start_daemon(argv), sample_liveness(daemon),
close_epoch(daemon_or_none,deadline), consume_snapshot(receipt,phase),
snapshot_finished(receipt,*,success,locks_released), next_epoch(), and
finalize(deadline), consume_deletion(seal,remove) carry authority explicitly.
A daemon exposes its actual
identity/Popen and bounded text only; it has no fake children/live implementation.
finalize returns the distinct terminal seal or refuses. Snapshot consumption is
the authority check immediately before storage.cold_snapshot; next_epoch never
accepts a public evidence object. Direct in-process M4 calls require an explicit
runner; only the command entry performs kernel setup, never an imported test host.

### Sampled liveness is separate evidence

Before the first restart retain the existing requirement for at least one stable
live runtime child. A single bounded read-only /proc sample validates candidate
PID/start/PPID and parent generations using the existing sandwich predicates.
It never admits signal/cleanup ownership. Seven ambiguous edge predicates are
counted, not ignored or labeled complete: parent_missing/parent_zombie/
parent_reused/child_missing/child_reused/child_reparented/start_order. A stable
child may coexist with ambiguous sampled edges; kernel closure independently
covers even unsampled descendants. M4 fails if there is no stable child, any
unreadable/malformed stat, namespace mismatch, exhausted scan/history bound or
root drift.
Do not clear a generic observation_error or claim its old predicate passed.
M4's explicitly new authority is the receipt, whose proof is stronger than sampled
absence; generic observer refusal and other profiles stay unchanged. Subsequent
epochs need no invented child samples; their direct root liveness and closure
remain mandatory. Public child arrays contain only actually validated samples.

### Frozen additive lifecycle schema and constants

Every new M4 normal/partial report includes storage_lifecycle, projected by the
new module independently of unchanged storage/storage_partial. Exact top keys:
schema_version=1; mode="kernel_epochs"; limits (below); epochs (list length0..3);
failure (null or reason enum below); cleanup (exact status,reason,kernel_echild).
cleanup.status is not_run/verified/refused; kernel_echild is boolean meaning actual
ECHILD rechecked for final cleanup, not a cached observation. verified requires
kernel_echild=true and reason=null; refused requires a reason and never authorizes
removal; not_run requires kernel_echild=false and reason=null. A failed run can have
verified cleanup after an ordinary workload failure; this never makes it pass.

Each epoch has exactly index,phase,root,root_exit_code,was_running,forced,launches,
waited,pipes_open,threads_open,adopted_reaped,closed,snapshot_consumed,
snapshot_complete,locks_released,sampling,failure. index1..3 maps to the ordered
phases above, with no gaps/repeats. root is null before spawn or exact numeric
{pid,pgid,start_ticks}; PID/PGID positive, start nonnegative. Roots are distinct.
root_exit_code is null or integer -255..255; was_running null or boolean; forced,
closed,snapshot_consumed,snapshot_complete,locks_released are strict booleans.
Counts are nonnegative strict integers, never booleans. Per epoch,
launches<=max_launches, waited<=launches and adopted_reaped<=max_adopted_reaped.
Also sum(launches)<=max_launches, sum(waited)<=sum(launches), and
sum(adopted_reaped)<=max_adopted_reaped across all epochs.
pipes_open<=min(3*launches,max_pipes);
threads_open<=min(2*launches,max_threads), including any outstanding HTTP timer.
closed implies waited==launches, pipes_open==threads_open==0 and failure=null.
Root-present closed success requires was_running=true, exit0 and forced=false.
Root-null closed is permitted only in a failed report before that current epoch's
daemon creation, including epoch2/3 after preceding snapshots have completed.
It requires root_exit_code=was_running=null and forced=false and cannot supply a
snapshot or normal daemon-shutdown claim.
snapshot_consumed implies closed and root present; snapshot_complete implies
snapshot_consumed and locks_released. A later epoch requires the preceding
snapshot_complete. No failed epoch supplies a snapshot. Successful M4 requires
three closed/snapshot-complete epochs, cleanup verified and failure=null.

sampling has exactly attempted,stable_children,ambiguous_edges,reasons. attempted
is0/1; reasons has exactly all seven predicate keys, each a strict integer
0..max_sampled_generations, summing to ambiguous_edges. Per epoch,
0<=stable_children<=max_sampled_generations and
0<=ambiguous_edges<=max_sampled_generations. Unattempted sampling requires all counts0.
Only epoch1 may sample and complete success requires attempted1/stable_children>0.
Sampling is always incomplete-tree evidence, even if ambiguous_edges==0.
stable_children+ambiguous_edges<=max_sampled_generations; this bound counts
ambiguous proposed generations too, not just stable admitted samples.
Visit each proposed edge at most once per sample; no retry of an ambiguous edge.
No candidate identity/path/argv/raw exception appears in this extension.

Reason enum: unsupported,namespace,policy,launch,wait,identity,output,children,
limit,deadline,cancelled,root_exit,forced,receipt,locks,sampling,schema. failure
and per-epoch failure are lifecycle authority errors only, using null or one of
these fixed enums. Ordinary HTTP/workload or storage-metadata failure leaves
these authority fields null when authority is intact; closed epochs and verified
cleanup may then remain valid, while the overall report is still failed and the
original error remains recorded. Lifecycle deadline/limit/receipt/schema failures
are authority failures; ordinary storage metadata/schema/limit/HTTP errors or a bounded snapshot timeout are an
ordinary scenario failure unless it also causes authority/lock-release uncertainty.
Only the existing
strict failure diagnostic allowlist is used for its separate sidecar; do not add
raw reasons there. Rebuild typed output, reject extra/missing fields, duplicate
keys/nonfinite numbers/booleans-as-integers and inconsistent success/counts.
Serialize indent2/sorted keys/allow_nan=false and enforce extension bound before
the unchanged whole-report redaction/size guard. No private receipt nonce/hash
or unbounded process history is public.

limits has exactly max_epochs=3,max_launches=1024,max_adopted_reaped=1024,
max_proc_entries=8192,max_sampled_generations=1024,max_samples_per_epoch=1,
max_threads=16,max_pipes=3072,stat_bytes=4096,log_tail_bytes=32768,thread_join_seconds=2,
poll_seconds=0.01,extension_bytes=8192. No separate new stop/scenario allowance.
Log tail remains a bounded ring, not a new total-output limit on upstream logs.
All durations are finite numbers; exact constants are not user overrides.

### Implementation and qualification gate

New storage_lifecycle.py/tests and M4-only lab dispatch/wiring/harness tests;
storage.py, generic Process/command, fixtures/pin, M5/M7 remain unchanged. RED
causal fixture: stable child plus disappearing helper, with actual root exit0,
closed pipes/threads and ECHILD. Negative escaped live double-fork must block
snapshot/removal until its exact external test coordinator releases/reaps it.
Cover three epochs/replay, failed start/bootstrap/git/version, background/foreign
launch/wait, policy drift, root reuse/nonzero/force, output drain, cancellation,
limits/deadlines, malformed sampled records and strict forged schema negatives.
Ordinary metadata/workload failure must still fail but may clean under fresh
proof; every authority failure must preserve scope. Fixtures own/reap all children.

Root reviews/commits this baseline before explicit Phase B release. After focused
RED/GREEN, root independently reviews and runs one full offline gate, then may
release one original-artifact M4 run on a fresh non-root bounded network-disabled
runner with exact source/artifact hashes. Verify three closures/snapshots, fixed
workload/readback/Workflow and owned removal. Freeze any failure for diagnosis;
no automatic rerun. Hosted CI/publication and whole-mainline/usable acceptance
remain separate. No historical exact attribution is claimed.
