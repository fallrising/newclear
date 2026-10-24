# SDD: a reproducible private Workers runtime lab

Status: M1 implemented; executed results and their limits are recorded in
[STATUS.md](STATUS.md). Created: 2026-10-07. Scope: `labs/open-compute`.

## Current M7 lifecycle admission contract (T066, 2026-10-24)

The accepted repair is implemented only in explicit integration supervision mode.
Each existing `trial.py` invocation remains the same direct Popen child and becomes
a checked child subreaper before workload dispatch. A separate M7-private
`SupervisedCapture` delegates descendant closure to that first-party owner.
Generic `lab.Process`, the existing `Capture`, M1–M6 daemon identities and M5's
actual `-9` receipts remain unchanged. Manual mode without the private opt-in
descriptor retains its ordinary output and lifecycle behavior.

The opt-in supports checked Linux x86_64/glibc2 ABI: install and read back default
SIGCHLD with SA_NOCLDWAIT cleared, and set/read back child-subreaper status.
Unsupported proof refuses workload launch. This changes only a fresh first-party
owner process, never the integration parent, account or host signal policy.

The inherited Unix seqpacket channel uses strict version1 JSON packets bounded
to4096bytes, exact keys/types and PID/start/original-deadline binding.
READY(0) → ADMIT(1) → CLOSED(2) → ACK(3) is single-use; CANCEL/ABORT fail closed.
CLOSED creates a fresh private32hex closure nonce after actual kernel closure;
ACK echoes it, rejecting an ACK queued before closure. No argv, paths, raw errors,
credentials or signal targets come from packets. Private binding/nonce facts are
never public diagnostics. This correlates trusted first-party code, not hostile
same-UID authentication. Control descriptors are non-inheritable and rejected in
upstream pass_fds; actual executed-child tests verify absence.

Before CLOSED, irreversibly close launches, require all registered Popen waits
and pipe drains complete, join inner threads, verify signal/subreaper policy, and
let the sole main-thread waiter collect adopted exits until actual ECHILD.
WNOHANG zero, a dead root, pidfd exit or process-group disappearance is insufficient.
A live/double-fork child prevents closure; unknown, competing waiter, late launch,
output/history limit or deadline failure cannot become verified cleanup.
The owner adopts the existing yielded absolute150-second cleanup end through
`begin_cleanup`; it can only shorten its prior bound. The original wire deadline
never changes. READY also respects the existing per-phase readiness cutoff without
shortening the later serving lifecycle. No handshake or cancellation renews a lease.

Opted init/serve shutdown completes ordinary daemon guards but saves clean=false.
CLOSED may request a private digest of that validated dirty manifest, immutable
manifest file metadata, root/lock identities and lock change time, trial and scope.
Other clients, including stop, never request another owner's clean transition.
The parent validates CLOSED while the exact owner is alive/unreaped, sends matching
ACK, then requires actual exit0, complete bounded stdout and expected terminal
result. Supervised serve's terminal result explicitly says clean_pending; it does
not claim clean=true while disk is dirty.

Only after those proofs does the parent acquire StateDirectory's existing lock,
revalidate the exact binding and scope, and atomically save clean=true.
Cancellation check/commit are serialized; cancellation before commit's lock
linearization prevents it. Existing atomic-save interruption can leave false or
true only after all closure/exit/output proof exists; a failed save still fails
the operation and never supplies a passing acknowledgment. Lost/killed owner,
EOF, stale/replayed frame, partial drain, manifest/lock drift or cancellation
cannot substitute for proof or authorize deletion. Known-generation containment
is distinct from verified completion.

Historical T063 alternatives are superseded: a pre-reap acknowledgment alone
cannot account for an escaped double-fork descendant; a separate proxy would
change PID/wait semantics without an adapter; a delegated cgroup would add a
larger environment contract. Neither sleeps/retries nor ignoring child_missing
is an accepted repair. The unchanged generic observer still refuses that case.

Offline evidence is318tests on the frozen candidate, independently repeated by
root. T067 accepted the source; T069's separately released original M7 trial
passed (see STATUS). Publication/CI remains a separate gate. This contract does not
identify the vanished generation in the historical trial or qualify all M4 races.

## 1. Problem and outcome

An independent developer needs evidence that a self-hosted Workers-style
platform can run a useful stateful path and be operated predictably. Installation
success and a platform health endpoint do not answer whether deployed code,
database state, and durable execution survive a daemon restart.

This lab produces a reproducible experiment around upstream open-compute. The
first milestone (M1) runs one trusted JavaScript Worker, one D1 database, and one
Workflow on the original pinned release, waits at a durable checkpoint, restarts
the daemon with the same data, then delivers an event and verifies completion.

The first-party product is a small operational harness, fixture, and evidence
contract. Upstream supplies the runtime. No upstream source or release binary
is vendored into this repository.

## 2. Success and scope

M1 answers these questions with actual execution:

1. Can a fresh non-root scope start the pinned runtime without installing a
   machine service or exposing a public listener?
2. Can a Worker be deployed through the platform API and use a D1 binding?
3. Does duplicate submission preserve one logical row?
4. Does a Workflow that has durably reached an event wait resume after a normal
   daemon restart, retaining database state and its original identity?
5. Is an already committed callback replayed from its durable result, rather
   than executed again in this specific test?
6. Can a second developer reproduce the evidence and understand a failure?

M1 does not implement a new Cloudflare clone, an Agent product, a Linux command
sandbox, a control plane, autoscaling, high availability, or a production host
adapter. It does not establish all API compatibility, external exactly-once
effects, malicious-tenant isolation, performance targets, a complete cold
restore, SIGKILL recovery, or an upgrade/rollback procedure.

## 3. Upstream identity and trust

| Item | Pinned identity |
| --- | --- |
| Repository | `https://github.com/elliothux/open-compute` |
| Release | `v0.2.4`, published 2026-10-05 |
| Source commit | `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d` |
| Linux x64 asset | `ocd-v0.2.4-linux-x64` |
| Asset bytes | `195537392` |
| Asset SHA256 | `8829a5bcb334dd3bbd8dc949ad9a2afdfe0e1fef44035c041556cd12087c586f` |
| workerd build | `v1.20260930.0-open-compute-r4.e98a3e843` |
| workerd source | `e98a3e8433979356047a202d3e0d1b0e2e2c4b8c` |

These release metadata values are the expected identities, not evidence of a
successful local run. `upstream.lock.json` encodes the machine-readable
download contract. The harness checks bytes and SHA256 before execution, also
when a previously downloaded file exists. A mismatch fails closed. Version text
alone is not sufficient identity. Downloading the asset requires internet
access; the workload itself uses only loopback synthetic inputs.

The harness has the root repository's MIT license. Upstream remains Apache-2.0
with its own dependency notices; this lab does not relicense or redistribute it.

Only the checked-in trusted fixture runs. Upstream documents that Worker
outbound fetch can reach addresses the host can route to, including private,
loopback, link-local, and metadata addresses. A loopback ingress listener and a
non-root UID do not provide per-tenant network isolation. This experiment does
not accept arbitrary user code or production credentials.

## 4. Architecture and ownership

| Component | Owns | Interface |
| --- | --- | --- |
| Python harness | Download verification, preflight, owned process lifecycle, API calls, assertions, redacted evidence | `make check`, `make integration` |
| Original `ocd` | Platform entry point, instance registry, resources and coordination | Foreground CLI, local control socket, v4 API |
| Supervised `workerd` | Worker and Workflow execution | Runtime supervised by `ocd` |
| Synthetic Worker | Bounded job submission and D1 observations | Loopback HTTP with discovered Worker host routing |
| Synthetic Workflow | Instrumented durable step, event wait, completion | Same-script Workflow binding and v4 instance/event API |
| Run-owned storage | Platform configuration, keys, D1 and scheduler state | One freshly created user scope and one lab instance |

The lab creates and owns its runtime scope. It does not own machine users,
firewall rules, Docker, system services, a shared workload catalog, or other
projects' runtime instances. A future host integration must preserve those
separate authorities.

## 5. Environment and lifecycle contract

M1 supports Linux x64 and a real non-root account with a writable passwd home.
The release chooses user scope from the account's home directory; changing
`HOME` or inventing an instance config flag on `ocd run` is not an isolation
mechanism. Root, unsupported platforms, an existing scope (including a symlink),
or an unavailable loopback port must fail before runtime mutation.

The supported test location is a fresh disposable development account or an
ephemeral GitHub-hosted Linux runner. The current authoring container is root;
it can run offline checks but cannot establish release runtime success.

The foreground bootstrap is derived from the pinned CLI and registry source:

1. Exclusively create the new user scope, directories with mode 0700, an
   unpredictable per-run ownership marker, and token/config files with mode 0600.
2. Write an empty top-level instance list and a server section bound only to
   `127.0.0.1`; reference the admin credential through a file.
3. Start `ocd --no-update-check run` in an owned process group. Await its control
   socket and bounded HTTP response without interpreting shared readiness as
   proof of an active instance.
4. Use the regular instance setup command through the running daemon, with a
   lab instance name, its explicit config path and an owned data directory.
5. Read the created instance and deployer token; discover its account and verify
   actual deployed execution before declaring startup successful.

Every subprocess, HTTP operation and polling phase has a finite timeout.
Redirects on management requests are rejected; tokens must not be forwarded to
another origin. Worker endpoint discovery supplies routing metadata only: TCP
connections remain at the harness's loopback address and the validated endpoint
host becomes the HTTP Host header.

Shutdown requests SIGTERM from the owned daemon, waits for its exit and its
supervised runtime children, and fails the graceful-restart acceptance if it
requires forced termination. Bounded SIGKILL is a cleanup fallback, not evidence
that graceful shutdown passed. Never kill by process name or affect an unrelated
process. Cleanup can remove only the scope created by this invocation after
matching its marker and confirming owned runtime exit. Existing state is never
adopted, reset, pruned, or upgraded.

## 6. Probe and data contract

The fixture holds synthetic job rows keyed by a bounded caller-provided ID.
The Worker accepts only a small documented JSON/body shape and supported routes;
it cannot execute caller code or select an outbound URL. Repeating the same
submission returns the existing logical job; a unique database key enforces one
row. This tests application idempotency for submission only.

The Workflow receives one previously submitted job ID and does the following:

1. A named `step.do` increments a dedicated callback counter in D1, writes a
   generated nonce, and returns that nonce. The counter deliberately makes an
   unexpected repeat observable; an upsert that hides a second execution is
   insufficient for this assertion.
2. A named `step.waitForEvent` waits for a synthetic approval event with an
   explicit timeout. The harness must observe the public instance status
   `waiting` before shutdown and capture counter=1 and the stored nonce.
3. After the same daemon data is reopened, the harness reads the original job
   and Workflow ID, sends the approval event, and polls to the public terminal
   status `complete`. A final named step records completion. The original
   counter must still be 1 and the first step's nonce must be unchanged.

Restart here means stopping and starting the `ocd` process. Calling
`WorkflowInstance.restart()` starts a different logical attempt and cannot
satisfy this contract. A new Workflow ID or a newly bootstrapped data directory
also cannot satisfy it.

The callback instrumentation is deliberately a diagnostic fixture, not a
production effect protocol. Upstream callbacks may run more than once before
their result is durably committed; external side effects are not rolled back.
The observed counter proves only the already committed step in this normal
restart scenario. It is not a general exactly-once guarantee.

## 7. Acceptance and evidence

| ID | Gate | Observable result |
| --- | --- | --- |
| AC-01 | Pin verification | Exact source/release/asset SHA256; tampered or wrong-size binary rejected before spawn |
| AC-02 | Ownership preflight | Root, unsupported platform, existing/symlinked scope and occupied port rejected without overwriting state |
| AC-03 | Real deployment | Active instance, actual Worker response and D1 binding write/read succeed; shared health alone cannot pass |
| AC-04 | Duplicate input | Two submissions with one ID yield one persisted logical row |
| AC-05 | Durable wait | Original Workflow ID reaches `waiting`; callback counter is 1 and nonce is captured |
| AC-06 | Daemon restart | Original daemon and children exit after SIGTERM; new process identity uses the same scope, instance and data |
| AC-07 | Resume | Existing D1 row survives; original Workflow receives event and reaches `complete`; counter and nonce stay unchanged |
| AC-08 | Failure containment | Bounded calls/polls and process cleanup; evidence contains no token, key, Authorization header or raw config |

Offline unit tests cover meaningful harness boundaries: pin corruption, scope
ownership/no-clobber, URL/redirect policy, polling terminal failures/timeouts,
redaction and evidence assertions as applicable. They may use local fixtures
or test doubles. They do not satisfy AC-03 through AC-07.

The real integration gate downloads and executes the pinned release on a fresh
non-root runner, deploys through the management API, and performs all assertions.
It emits a bounded JSON report with schema version, source and artifact identity,
run ID, environment, assertion results, original Workflow ID, before/after
daemon identities, same-data confirmation and observed counter/nonce comparison.
Success is emitted only after the complete path and cleanup succeed. A failing
run exits nonzero, names the failing phase, preserves only sanitized diagnostics,
and does not relabel an unavailable runtime as a passing or skipped integration.

CI uses a component-scoped root workflow with pull request, main push and manual
triggers; immutable action pins; read-only repository permissions; no persisted
checkout credential; finite job timeout; cancellation concurrency; and no deploy
or release action. Reports may be uploaded as short-lived artifacts only after
sanitization. Raw scope contents and credentials are never artifacts.

`docs/STATUS.md` records actual command results and links the tested commit and
CI run. `docs/quickstart.md` is the single golden path; it distinguishes commands
executed in the authoring environment from the real non-root CI result.

## 8. Decisions and later integration

| Decision | Reason | Consequence |
| --- | --- | --- |
| Evaluate upstream rather than fork it | The uncertainty is operational fitness | Patches to upstream require a separate decision |
| Standard-library harness and direct v4 API | Small reproducible toolchain; exercises deployed runtime | This milestone does not validate Wrangler or cf/Vite tooling |
| Original non-root foreground release | Avoid machine service mutation and test-only bypasses | Fresh account/runner required; no arbitrary scope relocation |
| One Worker, D1 and Workflow | Small stateful path can fail meaningfully | Other bindings remain unverified |
| Normal daemon restart first | Bounded recoverability test | Crash, cold restore and upgrade remain separate gates |
| Separate host/workload/runtime authority | A runtime needs typed lifecycle, storage and resource contracts | No general root shell or automatic host changes |

A future adapter should consume a typed runtime declaration (artifact identity,
scope, instance, listener, storage roots, resource/network policy and readiness)
and expose explicit start/stop/status/backup contracts. A generic executable
accepting `PORT` and one data directory must not be assumed to cover this
multi-process, scope/instance-based platform. Machine provisioning remains with
the host owner; workload publication remains with the workload owner.

Potential next gates, after M1 evidence is reviewed: full cold backup/restore
including keys and object payloads; actual application API compatibility;
process-tree resource measurements; egress policy and hostile input isolation;
upgrade rehearsal; then a narrow host adapter. They are not implemented or
implicitly passed by this milestone.

## 9. Primary sources

Source inspection date: 2026-10-07. Mutable documentation is corroborated against
the pinned source where possible. Read source is not an executed test result.

- [Release v0.2.4](https://github.com/elliothux/open-compute/releases/tag/v0.2.4)
- [Pinned source](https://github.com/elliothux/open-compute/tree/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d)
- [CLI model](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/cli/model.rs)
- [Instance registry](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/crates/service/src/instance_registry.rs)
- [Workflows semantics](https://open-compute.dev/docs/workflows/)
- [Security policy and network boundary](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/SECURITY.md)
- [Backup boundaries](https://open-compute.dev/docs/ocd/backup/)
- [Cloudflare workerd security boundary](https://github.com/cloudflare/workerd)

## Issue548 maintenance: diagnostic artifact contract v1

This contract precedes the diagnostic implementation. Existing runtime/ownership
refusals, original report shapes, workload, deadlines and command exit remain unchanged.
A separate `failure-diagnostics.json` records no raw exceptions or runtime text.
It has exactly schema_version1, profile (restart/restore/resources/storage/crash/retry/trial),
source_commit (40 lowercase hex or null), result (passed/failed/unknown), phase
(fixed harness phase enum or unknown), exit_code (integer-255..255 or null),
report_written (boolean), evidence (record/report/missing/invalid), and failures.
Failures has exactly original/cleanup/evidence; each is null or exactly phase,
category (fixed public error enum or unknown) and observation (fixed process-edge
reason enum or null). Record the first failure in each slot before later cleanup
or report projection; never replace the original with a generic later error.

Only independently validated, rebuilt fields may be serialized. A private normal
report is input data, not a trusted diagnostic object: extract only bounded known
facts, ignore unrelated raw diagnostics, map unknown free strings to unknown, and
never copy paths/argv/hostnames/config/nonces/credentials or their hashes. Direct
versioned records reject extra keys, duplicates, nonfinite values, booleans-as-numbers,
invalid enums and oversized data. Input is a no-follow, bounded regular current-UID
file; symlink/multilink/unsafe files are invalid. Publication uses an owned safe
parent, exclusive no-follow0600 file and finite bounds. Failed publication never
changes the runtime's original exit or rewrites its report. CI's separate always-run
collector supplies a minimal unknown record if evidence is missing/invalid and
publishes only its explicit allowlisted profile basename, never raw logs.

A ProcessObservationError may carry a fixed reason to distinguish parent disappearance,
parent reuse/zombie, child disappearance/reuse/reparenting or inconsistent start order;
recording must preserve the existing combined fail-closed condition and message.
No new generation is admitted after refusal and unknown is not cleanup success.

CI keeps approved report artifacts and strict diagnostics for30days (subject to
repository policy). Four-profile real qualification uses the unchanged original
locked artifact in separate fresh non-root containers with real passwd homes,
loopback ingress, no external runtime network and bounded owned cleanup. A new
failure remains evidence, not permission to relax the gate. Historical logs for
issue548 were retrievable; docs must distinguish them from ephemeral artifact
retention, prior repairs and unproved current root cause.
