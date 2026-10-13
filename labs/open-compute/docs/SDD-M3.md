# SDD M3: bounded observed process-tree resource characterization

Status: reviewed implementation contract; executed results belong in docs/STATUS.md. No resource measurements are claimed by this document.
Baseline: product main `c0e2bf9a68d4ce73128af37b435f378c6ad89dd1`. Extends M1 without changing M1/M2 historical contracts or evidence.

## Outcome

Add one `integration-resources` scenario around the unchanged original open-compute v0.2.4 release and existing trusted Worker/D1/Workflow fixture. Preserve normal restart, duplicate-row, same Workflow ID, counter/nonce, graceful shutdown and owned cleanup assertions. Record finite Linux process resource observations before and after that restart. This addresses the SDD's explicit process-tree resource gap before any host adapter work.

No new package, service, cloud resource, upstream patch, safety override, user impersonation, general load generator, public listener, production deployment or adapter is included. Capacity, physical unique memory, complete lifetime CPU, performance guarantees, security isolation and application/API parity remain unverified. Do not upgrade the artifact or change existing cold backup semantics.

## Ownership prerequisite

Correct `Process` descendant bookkeeping so history retains `(pid, start_ticks)` generations and descendant discovery can admit a new generation only through an observed owned parent. Unrelated PID reuse never becomes ownership. A reparented previously observed generation remains tracked. Add a bounded copied identity view, including the root, for observation only. Keep process signaling and scope cleanup exclusively in the existing lifecycle owner.

Proc enumeration is non-atomic. A stored PPID from an earlier scan cannot authorize a descendant by itself. For every proposed new generation, re-read its candidate stat and the claimed parent's stat around admission; the parent must still match an already authorized PID/start generation, and the candidate must still match PID/start/PPID and not predate the parent. Validate each new edge back to a live authorized generation; on ambiguous observation fail closed, preserve history and refuse verified cleanup. Add a stale-parent-reuse regression distinct from the existing PID-keyed-history reproduction. These checks reduce race exposure; they do not establish an atomic global process snapshot or malicious same-UID containment.

Bound a proc table scan to 8192 numeric entries and at most 1024 observed generations per process owner. An exceeded bound is an observation error, preserves known identities and fails verified cleanup; do not drop identities to manufacture coverage. These fixed small-lab ceilings are not global host capacity limits. Read at most 4097 stat bytes and reject records exceeding 4096. Keep namespace and unknown observation rules intact.

The copied view includes retained historical generations; resource acquisition's separate 512-identity ceiling applies to that full requested view. Do not prune missing histories or guess live generations to avoid the ceiling. If the retained view exceeds 512, M3 acquisition fails even though lifecycle history can safely retain up to 1024 generations.

## Observation interface

First-party `resources.py` provides stat parsing, numeric-only sample acquisition, phase reduction and a strict public projection. It consumes a copied list of lifecycle-authorized `(pid, start_ticks)` identities. It never discovers processes by names, signals runtime processes, examines argv/environment/maps, or approves source deletion.

Sampler contract for integration: `observe_phase(name, identities, *, duration_seconds, probe=None, probe_count=0)` where `identities()` returns a copied authorized generation list or raises on lifecycle error. It returns one strict public phase summary. A supplied `probe(absolute_phase_deadline)` is a harness-owned validated GET callback, never a user-provided URL or command. Resource reads run in an observer thread while the caller executes serial probes. This prevents HTTP work from stopping scheduled resource acquisition. Resource acquisition uses trusted private helper subprocesses so parent waits are bounded; each sample request/reply is fixed-schema and numeric, helper output is bounded, and failure is not retried invisibly. The observer/helper never alters the harness's signal handlers. Per-sample helpers are permitted; their overhead and acquisition gaps must be recorded.

The numeric helper request is an object with exactly `identities` (unique objects with `pid` and `start_ticks`, strictly positive integer PID and nonnegative integer ticks). Response has exactly `records`; each record contains `pid`, `start_ticks`, `status` (`live`, `zombie`, `missing`, `reused`), `rss_pages` and `cpu_ticks`. Missing/reused metrics are null. Live/zombie metrics are nonnegative integers. No additional keys, duplicate JSON keys, NaN/Infinity, arbitrary paths, strings or raw OS errors are accepted. Unit metadata is trusted parent `SC_PAGE_SIZE` and `SC_CLK_TCK`. Parser/acquisition failure raises a fixed reason exception rather than returning a partial readable-subset peak.

Public phase projection is frozen to: `phase`, `status`, `elapsed_seconds`, `samples_attempted`, `samples_valid`, `scheduled_slots`, `skipped_slots`, `max_sample_gap_seconds`, `max_scan_seconds`, `peak_sampled_rss_bytes`, `observed_cpu_ticks`, `observed_cpu_seconds`, `cpu_pairs_observed`, `peak_live_process_count`, `missing_observations`, `reused_observations`, `zombie_observations`, `cpu_unpaired_observations`, `probe_attempted`, `probe_completed`, `reason`. Counts are nonnegative integers excluding booleans; durations finite nonnegative numbers; unavailable metrics are null. Allowed status is `observed`, `failed`, `insufficient_samples`; reason is null or fixed enum (`identity_error`, `identity_limit`, `stat_error`, `counter_regression`, `protocol_error`, `helper_timeout`, `helper_cleanup`, `sample_limit`, `phase_timeout`, `probe_failed`, `insufficient_samples`). Required successful windows have a live original root in every valid scan, at least two valid scans and one paired own-CPU interval; a missing/zombie/reused root fails the window. The identity view always returns the root first, followed by unique retained descendant generations; the observer never nominates a replacement root. Top-level resources has exactly `schema_version` (1), `units` (`page_size_bytes`, `clock_ticks_per_second` positive integers), `limits` (fixed SDD constants), `limitations` (fixed scope/unknown/overhead fields above), `phases` (four fixed names and summaries). Helper replies must match the requested generation set exactly, without duplicate/extra/missing records; nesting is fixed-schema only. Serialize with indent=2 and sort_keys=True for both the 48 KiB extension bound and whole-report check.

Defaults: 250 ms scheduling interval, 512 identities per sample, 4096 bytes per stat, 64 KiB protocol message, 1 second helper acquisition deadline clamped to remaining phase time, 64 sample attempts per phase, 8 named phase summaries maximum, 48 KiB public resource extension. Each helper close allows 0.5 seconds after terminate, then 1 second after kill; the observer thread join is capped at 3 seconds. Failure to verify helper exit or join fails acquisition and never reports successful cleanup. Report actual scan windows and gaps; never imply atomic observation or a bound on uninterruptible kernel I/O.

The M3 harness uses its main-thread deadline context for a 300-second scenario budget beginning before first daemon spawn, separate from download. Original Workflow deadline stays 300 seconds from creation; approval/terminal polling use remaining margin. Final cleanup is a separate 150-second context, covering finite existing Process.stop operations, observer/helper closure and scope removal. M3-owned scope removal has an explicit nested 30-second M3 deadline context, equivalent to M2's separate cleanup bound while preserving the outer absolute deadline; interruption/unknown cleanup preserves unfinished authority and fails M3. M1's historical unbounded removal is not relabeled as bounded. No observation thread changes SIGALRM; all harness deadline contexts restore prior handlers/timers. Test timeout/failure paths, including incomplete helper reap, before real integration.

## Fixed workload

Observe four required windows, all while the original Workflow waits:

1. `source_idle`: 3 seconds; no deliberate requests.
2. `source_read_probe`: 4 seconds; eight validated serial GETs, alternating fixture health and the original D1 job read at minimum 0.5 second spacing.
3. `restarted_idle`: 3 seconds after normal daemon restart and original state readback.
4. `restarted_read_probe`: same fixed eight GETs and 4-second window.

Serial probe starts are scheduled at phase offsets 0, 0.5, 1, 1.5, 2, 2.5, 3 and 3.5 seconds, with minimum 0.5-second spacing from the actual preceding start. The last request has only the remaining phase time; each TCP/write/header/body operation and watchdog is clamped to the absolute phase deadline rather than the default 20-second HTTP budget. Extend LocalHTTP with an optional absolute deadline without changing default M1/M2 behavior. A delayed request that prevents eight completed probes by four seconds fails the phase; do not stretch the window or fabricate workload counts. Observer close follows a separate finite close budget and late replies cannot add post-deadline metrics.

Each required phase needs at least two valid samples and must meet its workload count. Record attempted and completed reads, elapsed monotonic time, valid sample counts and maximum actual inter-sample gap. Any required read failure, unknown lifecycle observation, malformed/unreadable resource record, sample/process ceiling or helper failure fails M3. A missed interval above 0.5 seconds resets CPU pairing and increments unpaired observations; it does not create an observed CPU delta across an unmeasured gap. Short-lived processes between scans and descendants never discovered by the lifecycle monitor remain unknown even on success.

## Measurement semantics

- RSS is process stat resident pages times recorded `SC_PAGE_SIZE`. A phase peak is the maximum aggregate of one validated bounded scan's live identity readings. Do not sum each process's separate peak. Shared pages may be counted repeatedly; no PSS/unique-memory claim.
- CPU is only own `utime + stime`, excluding child counters. Sum nonnegative tick deltas only for consecutive valid observations of the same PID/start generation within the same phase, converted using recorded `SC_CLK_TCK`. New identities establish baselines. Exit/reuse cannot create a zero endpoint or cross-generation subtraction. Missing final intervals remain unknown. No utilization percentage or lifetime total.
- Same-generation zombies contribute no live RSS; count the observation and allow a final own-CPU pair if available. Missing records and changed start ticks are explicit absent/reused observations, never adopted replacements. Permission, parse, negative/regressing counters and protocol faults are fixed public reason codes, never raw private diagnostics.
- Every summary declares observed-descendants scope, non-atomic scan, unknown full-tree/between-sample coverage, potential missed short-lived processes, approximate/shared RSS and observer/helper overhead. Harness, sibling CLI/helper processes and cold-backup costs are excluded.

Linux documents asynchronous RSS accounting and the meanings of stat own/child CPU counters in its [proc filesystem documentation](https://docs.kernel.org/filesystems/proc.html), inspected 2026-10-13. That source defines measurement inputs; it is not an executed runtime result.

## Acceptance IDs and evidence

| ID | Required result |
| --- | --- |
| M3-01 | Exact original pin, fresh non-root environment, deployed trusted Worker/D1/Workflow and duplicate row checks pass. |
| M3-02 | Owned identity generation discovery, stat units, acquisition/protocol bounds and meaningful negative tests pass. |
| M3-03 | All four required windows have valid finite observations and exact fixed GET counts, with no concealed required acquisition failure. |
| M3-04 | Real normal restart and completion preserve original state/Workflow/counter/nonce; actual daemon and observed children exit gracefully; owned cleanup passes. |
| M3-05 | Separate bounded sanitized report records exact source/artifact identity, workload, metrics, acquisition coverage and limitations; no raw stat/command/path/token/config or existing evidence rewrite. |

All runtime gates begin `not_run`; real runtime is necessary for M3-01/03/04/05. Use strict numeric/enum field allowlists for resource summaries before the existing whole-report secret scan. Keep historical M1/M2 files unchanged. Failed or unavailable acquisition produces a failed run with sanitized partial evidence, not zero measurements or success. Source/PID identity plus observed figures remain tied to the actual tested commit/tree and environment.

## Delivery and verification

Define/review this contract before code. After required authorization and ledger claim, commit the reviewed contract baseline before implementation. Builders use Red-Green-Refactor in disjoint fresh worktrees; lifecycle and harness edits to lab.py run sequentially. Root integrates and reruns checks; fresh independent review follows.

This milestone observes only the four specified windows. Startup, shutdown, resume and cold-backup resource costs are excluded. Lifecycle monitoring still begins at process creation. The fixed constants and schema here are the implementation contract.

Meaningful tests: PID reuse descendant plus grandchild versus unrelated reuse; reparenting and unknown observations; bounded scans; tricky comm parsing and record/units/counter validation; scan aggregate peak versus sum of peaks; CPU generation/gap/phase accounting; zombie/absence reasons; helper timeout/protocol/ceiling containment; GET/phase failures preserve functional cleanup; malicious extra/path/credential fields cannot enter output. Controlled local process tests verify observer plumbing; original-runtime integration verifies M3.

Operator interface: Makefile `integration-resources` and `python3 lab.py integration-resources`, accepting the existing cache/output/port options. Scoped CI retains M1 and M2 and adds a separate M3 report artifact; if local real-runtime execution is unsupported or cannot own a disposable scope, use the authorized ephemeral non-root CI runner. Preserve required checks and report any unavailable gate honestly.
