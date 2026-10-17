# Run the runtime experiments

This is the single operator path for M1 in [SDD.md](SDD.md) and the M2 cold
restore experiment in [SDD-M2.md](SDD-M2.md). It
also supplies the fixed resource observation scenario in [SDD-M3.md](SDD-M3.md).
Each command
downloads the original **v0.2.4 Linux x64** release, verifies its pinned size and
SHA256, and exercises a synthetic Worker, D1 database, and Workflow. The harness
uses Python's standard library and requires Python 3.11 or newer, Git, and make.

## 1. Check the harness

From the repository root:

```sh
make -C labs/open-compute check
```

These offline tests check corruption detection, ownership, bounded operations,
redirect policy, credential handling, process cleanup, and replay assertions.
They do not run or certify open-compute. Consult [STATUS.md](STATUS.md) for the
actual tested commit, command results, and real CI evidence.

## 2. Choose a fresh non-root environment

Use a disposable Linux x64 account with an owned writable passwd home, or the
component's ephemeral GitHub Actions runner. A root account or mismatched PID
namespace fails preflight. A successful preflight does not make a persistent
operator home disposable; use a fresh account for the real experiment.

The account must have no existing `~/.open-compute`, including a dangling
symlink. The release resolves its user scope from the account database; setting
`HOME` does not relocate that scope. Do not delete an existing scope to make the
probe pass. No system service, Docker daemon, new machine user, or upstream
safety override is installed by this harness.

```sh
make -C labs/open-compute preflight
```

Preflight does not start a runtime. It checks the platform, real non-root
identity, home ownership, scope absence, and availability of port 8787 on
`127.0.0.1`. It also requires the process PID namespace to match the readable
`/proc` namespace so child identities can be verified safely. Use
`python3 labs/open-compute/lab.py preflight --port 8877` to test
a different unprivileged loopback port.

## 3. Run the normal-restart experiment (M1)

```sh
make -C labs/open-compute integration
```

The asset is approximately 196 MB and requires access to GitHub release assets.
The hash in [upstream.lock.json](../upstream.lock.json) is checked before every
execution, including use of the local cache. No `curl | sh` installer runs.
Defaults place the executable in the ignored `.lab-cache/` and a sanitized
JSON report in a new `.lab-runs/<run-id>/` directory under this component.

Optional explicit cache, report directory, and port:

```sh
python3 labs/open-compute/lab.py integration \
  --port 8877 \
  --cache /tmp/open-compute-lab-cache \
  --output /tmp/open-compute-lab-evidence-first-run
```

The report directory must be new. Cache and output paths must be outside the
runtime scope, and the output directory cannot contain the cache. Unsafe or
already-existing output paths are rejected before download/start; their failure
report is printed only to stdout and never written into the refused path.
Each invocation creates its own empty user
scope and marker, starts `ocd --no-update-check run` in the foreground, and asks
the running daemon to create exactly one lab instance. Management requests use
the generated deployer token in memory, over loopback. Worker routing comes
from endpoint discovery while the TCP destination remains `127.0.0.1`.

The experiment then deploys the fixture through the v4 API, writes a D1 row,
submits the same ID twice, starts one Workflow, and waits for its durable event
wait. Its first callback increments a counter and returns a nonce. The harness
sends **SIGTERM to the actual daemon**, verifies exit of the daemon and its
observed supervised children, then starts the original release with the same
scope and data. After reading the retained row, it sends an approval event to
the original Workflow ID. Success requires terminal status `complete`, counter
still 1, and the original nonce in the database and Workflow output.

The report appears on stdout and in `report.json`. `result: passed` is emitted
only after AC-01 through AC-08 and final cleanup succeed. It records the harness
commit, release/artifact identity, process identities, state identity, and
counter/nonce comparisons. It does not contain credentials or raw configuration.

## 4. Run the complete cold-restore experiment (M2)

After M1 has removed its owned scope, run:

```sh
make -C labs/open-compute integration-restore
```

M2 accepts the same `LAB_ARGS`, `--port`, `--cache` and new `--output` directory
options. It creates a separate source instance, deploys the trusted Worker with
D1, R2 and Workflow bindings, and writes one small binary R2 object with HTTP and
custom metadata. It captures the original deployment/version/code digest and
bindings, then waits for the original Workflow's committed event wait.

The harness normally stops the actual daemon and verifies its children exited.
It obtains exclusive source locks, saves the **complete persistent scope and
instance authority**, and independently verifies the package against the cold
source. This includes configuration, keys, database state, Local object marker,
Worker bytes and R2 payloads. Only the exact transient paths and binary-derived
OCR asset subtree listed in SDD-M2 are excluded. Upstream's Local `ocd backup
restore` does not implement this operation; M2 tests the documented operator
cold-directory procedure.

After verification, M2 **actually removes its own source scope**, checks the
source and data paths are absent, and restores only from the saved package into
a pre-created empty staging directory with a different root identity. It verifies
every restored persistent file before installing the new tree at the original
scope path without overwriting an existing destination. It starts a new original
daemon using the recovered configuration and keys. It never runs setup, deploys
again, creates replacement resources or reseeds data during restore.

Recovery first uses an HTTP client restricted to GET requests. The original
instance/account/database, deployment/version/bindings, D1 row, and R2 bytes,
metadata, etag/version/uploaded timestamp must agree with the source observations.
The same Workflow must still be waiting. Only then does the harness submit its
approval event and require `complete`, counter 1 and an unchanged step nonce.

Shutdown, backup, extraction, restored startup and read-only checks share a
120-second budget. The Workflow's original five-minute timeout continues to
elapse; restore never resets it. Archive size, member count, paths and individual
files also have fixed bounds. This is a small fixture experiment, not a general
backup program for arbitrary instances or native extension state.

Secret-bearing backup data and its full inventory exist only in a private
temporary directory for this invocation, under `RUNNER_TEMP` when provided.
The package and staging directory are removed during verified cleanup. The
sanitized M2 report is separate from M1, uses acceptance IDs M2-01 through M2-09,
and records aggregate backup checks, source absence, fresh root identity,
readback comparisons, Workflow completion and cleanup. It contains no backup
paths, raw inventory, credentials, key hashes or R2 payload bytes.

M2 deliberately keeps the **same runner, absolute scope path and UID**, while
using a fresh directory tree and daemon process. A pass does not establish
cross-host recovery, another OS/UID/path, power-loss consistency or upgrades.

## 5. Observe the runtime process tree (M3)

After the preceding invocation has removed its owned scope, run:

```sh
make -C labs/open-compute integration-resources
```

Its CLI equivalent is `python3 labs/open-compute/lab.py integration-resources`,
with the same `--port`, `--cache` and new `--output` options. On this fresh
synthetic scope, the existing Worker/D1/Workflow path reaches its committed wait.
The harness then observes a three-second idle window and a four-second window
of eight serial GETs alternating fixture health and the original job read.
It normally restarts the daemon with the same data, verifies the original state,
and repeats those two windows before approving the original Workflow.

The resource helper reads only bounded numeric Linux stat records for lifecycle-
authorized PID/start-time generations. The report has four phase summaries,
page/tick conversion units, sampled aggregate RSS peaks, paired own CPU ticks,
valid sample and request counts, actual acquisition gaps and fixed limitations.
New, missing, reused and zombie generations remain explicit. A required unreadable
record, malformed protocol, helper timeout, insufficient samples or slow probe
fails M3 instead of turning a missing metric into zero. Helper processes and the
harness are excluded from runtime metrics, and observer overhead is disclosed.

RSS may count shared pages repeatedly; sequential scans are not atomic and may
miss between-sample peaks or short-lived descendants. CPU counts only paired
observations of the same generation within a phase, excluding unobserved final
intervals and gaps. These measurements describe this small trusted workload;
they do not measure saturation, whole-host resources, unique physical memory,
complete lifetime CPU, startup/shutdown costs or production capacity.

The scenario has a 300-second budget beginning before the first daemon spawn.
Every probe is clamped to its phase deadline, and the original five-minute
Workflow deadline still applies. M3 final cleanup has a separate 150-second
budget with a 30-second owned-scope removal deadline. Any unknown ownership or
incomplete runtime/helper cleanup prevents a successful report. The sanitized
report uses M3-01 through M3-05; real executed results are linked from STATUS.

## 6. Observe cold scope storage (M4)

After the previous invocation has removed its scope, run:

```sh
make -C labs/open-compute integration-storage
```

The CLI equivalent is `python3 labs/open-compute/lab.py integration-storage`,
with the same cache/output/port options. M4 uses the existing trusted fixture.
After its original Workflow reaches a committed wait, it stops the daemon
normally and takes a locked cold baseline. It restarts with the same authority,
checks sixteen fixed job IDs are absent, and submits each twice with the same
128-byte ASCII payload. After another normal shutdown it takes the written
snapshot, restarts, and reads all sixteen original rows before approving the
original Workflow. Completion retains the original counter and nonce. A third
normal shutdown produces the final cold snapshot, then owned cleanup runs.

Snapshots include all scope regular files except the harness ownership marker,
including OCR assets and transient content omitted from M2 backup payloads.
Six fixed path groups keep scope/data authority, Local objects, OCR and transient
content distinct without publishing inventories. Logical bytes count st_size;
allocated bytes count st_blocks × 512. Observed hardlink aliases count once per
inode. Directory/socket counts remain separate; their allocated blocks do not
enter byte totals. Same-device bind mounts, extent sharing/compression and
physical storage are unknown. These sequential cold endpoints cannot supply
peak usage, capacity, a growth rate, exclusively D1 effects or per-job costs.

M4 has a 300-second scenario budget, ten seconds per metadata scan, a separate
150-second cleanup budget and thirty seconds for owned scope removal. The
original five-minute Workflow wait is never reset. Existing locks must be
present and exclusively available; ownership, unsupported types, changed
metadata, incomplete traversal or any fixed ceiling fails the experiment.
No failed scan becomes zero-valued successful evidence. Application alarms do
not guarantee interruption of uninterruptible kernel filesystem I/O.
The separate strict storage report uses M4-01 through M4-05. Partial failed
reports include only completed snapshots and observed operation counts, with
no forged deltas. Real executed results and their exact source are in STATUS.

## 7. SIGKILL at the committed wait (M5)

After the previous invocation has removed its scope, run:

```sh
make -C labs/open-compute integration-crash
```

The CLI equivalent is `python3 labs/open-compute/lab.py integration-crash`, with
existing `--cache`, `--port` and a new `--output` directory. Read the
[M5 contract](SDD-M5.md) first. It uses the unchanged original artifact and
trusted Worker/D1/Workflow fixture on a fresh real non-root runner.

After the original callback is publicly committed and the Workflow waiting,
the harness freezes fresh live authorized process generations, requires a daemon
and child, sends SIGKILL to the daemon first and then every frozen child after
immediate PID/start validation. It does not kill by process name or PGID.
A required child disappearing before its own signal fails, even if parent loss
caused its exit. Root must exit by signal9; all retained observed history must
be nonlive and observers closed before restart is permitted.

The new daemon opens the same original scope/config/data/UID/path. GET-only
health/account/deployment/version/D1/original waiting Workflow comparisons must
pass before approval. No setup, redeploy, new Workflow, job submission or reseed
repairs the recovered state. The original Workflow then completes with counter 1
and unchanged nonce/output; the restarted daemon exits normally on SIGTERM.
Owned cleanup and exclusive strict sanitized evidence writing precede success.

M5 has a 300-second scenario budget, 10 seconds for abrupt termination, a separate
150-second cleanup, 30-second owned removal and 10-second evidence write. The
original Workflow cutoff is never reset. Its strict crash and readback receipt
uses M5-01 through M5-05; failed projection/write/cleanup revokes success and
retains bounded failure output. Required unknown ownership or exit prevents
scope deletion and restart. Only the exact verified intentional crash owner is
exempted from graceful shutdown requirements; unexpected final death fails.

The separate fresh non-root Python3.11 CI job has a 10-minute limit and uploads
only its explicit sanitized report for 7 days. Actual results, source/tree and
original report hashes are linked from STATUS. Sequential process signals at
one public committed checkpoint keep kernel/filesystem alive; no power-loss,
in-flight step, atomic whole-tree or production recovery conclusion follows.

## 8. Controlled Workflow failures and retries (M6)

On a fresh disposable non-root Linux x64 account, after any previous invocation
has verified removal of its scope, run:

```sh
make -C labs/open-compute integration-retry
```

The CLI equivalent is `python3 labs/open-compute/retry.py`, with `--cache`,
`--port` and a new `--output` directory. Read the [M6 contract](SDD-M6.md).
This uses the same pinned original artifact and a separate fixed trusted Worker.
It seeds three jobs before creating their Workflows, then runs them sequentially:
unguarded post-effect failure/retry (two effects), keyed post-effect failure/retry
(one effect), and retry exhaustion (two effects and an errored Workflow).
Independent callback entries record attempts 1/2 and the explicit policy. Each
entry must also acknowledge the successful effect statement and intended
throw/return outcome; effect counts alone cannot establish the injection point.

The harness checks exact initial state, original IDs, terminal output/error and
D1 observations, then repeats terminal and D1 reads. Public attempt/config
history is a placeholder and is not used as proof. Successful cases are recorded
only after stable readback. There is no restart, kill, approval event or external
application request in this scenario.

The scenario budget is 300 seconds, including setup. Each case has one absolute
60-second budget and the cases share at most 256 GET attempts, charged before
I/O. Final cleanup has 150 seconds, owned removal 30 seconds and evidence write
10 seconds. Success requires a running daemon to exit normally on SIGTERM,
all observed owned generations to exit, observers to drain and verified scope
removal. Failed ownership or cleanup cannot produce a successful report.
The separate fresh non-root Python 3.11 CI job has a 10-minute limit and retains
only its explicit sanitized report for seven days.

Markers record the reached post-effect checkpoint and intended outcome, not an
independent exception trace or exclusion of acknowledgement-loss windows.
These finite observations concern a synthetic local effect row. They do not
prove external exactly-once behavior, crash safety, future execution absence,
retry timing, throughput, concurrency or production readiness. Actual execution
and precise source/report provenance are linked from STATUS.

## 9. Operate a retained manual trial (M7)

This separate [M7 contract](SDD-M7.md) supports a foreground owner and finite
commands in another terminal. It does not install an account, machine, service,
boot hook or resource quota. Obtain host-specific permission before using a test
machine. Use a fresh disposable real non-root Linux x64 account whose passwd
home has no `.open-compute`. The M1–M6 integration runners must never be pointed
at this retained account: their cleanup contract is different.

Choose short absolute private paths below that account's actual passwd home;
replace `/home/trial-user` with that home in every command. Parent directories
must already exist, be owned and not group/world writable; no symlink ancestry.
The `state/control.sock` pathname must fit within 100 UTF-8 bytes. State and
cache must be separate and outside `.open-compute`. Changing HOME is insufficient.
From the repository root, initialize once:

```sh
python3 labs/open-compute/trial.py init --state /home/trial-user/oc-state --cache /home/trial-user/oc-cache
```

Expected: one JSON response with `command: init`, `result: passed`,
`data.initialized: true`. Initialization verifies the pinned artifact, deploys
the original trusted Worker/D1/Workflow, stops normally and **retains** its data.
Repeated init fails without replacing the original manifest or scope.

In terminal A, keep the owner in the foreground:

```sh
python3 labs/open-compute/trial.py serve --state /home/trial-user/oc-state --seconds 3600
```

Expected: `command: serve`, `result: passed`, `data.ready: true`; the command
remains running. It verifies the original deployment before accepting commands.
The default one-hour lease (maximum 24 hours) is a stop bound, not evidence of
reliability for that duration. Closing the terminal is not a way to install a
background service.

In terminal B, perform bounded operations:

```sh
python3 labs/open-compute/trial.py status --state /home/trial-user/oc-state
python3 labs/open-compute/trial.py submit --state /home/trial-user/oc-state --id trial-01 --payload synthetic-m7
python3 labs/open-compute/trial.py submit --state /home/trial-user/oc-state --id trial-01 --payload synthetic-m7
python3 labs/open-compute/trial.py read --state /home/trial-user/oc-state --id trial-01
python3 labs/open-compute/trial.py workflow --state /home/trial-user/oc-state --id trial-flow-01 --job-id trial-01
python3 labs/open-compute/trial.py stop --state /home/trial-user/oc-state
```

Status requires actual Worker health and original resource IDs. Both submissions
return the same row with `row_count: 1`; changing the payload under that ID returns
a failed `conflict` response and leaves the first payload unchanged. Workflow
returns `waiting`, callback_count 1 and a nonce hash. Stop returns normal
SIGTERM/exit0/no force/all owned exited; terminal A exits with clean=true.
The state directory and runtime data remain.

Restart the same serve command in terminal A. In B, use status and read first,
then approve the **original** Workflow and stop again:

```sh
python3 labs/open-compute/trial.py status --state /home/trial-user/oc-state
python3 labs/open-compute/trial.py read --state /home/trial-user/oc-state --id trial-01
python3 labs/open-compute/trial.py approve --state /home/trial-user/oc-state
python3 labs/open-compute/trial.py stop --state /home/trial-user/oc-state
```

Expected: the original row/Workflow IDs and nonce hash survive; approve returns
complete, callback_count 1 and completed 1. Start a third owner and read again to
verify the completed state survives another stop/start. There is only one
Workflow per trial. Complete this sequence within 270 seconds of creating it:
the fixture's original five-minute timeout is unchanged, with a 30-second
completion margin. Same-boot monotonic and wall clocks must agree; reboot or
clock uncertainty refuses pending approval. This is not an overnight wait test.

Stop before retirement. In an authorized disposable environment, this separate
command removes only the exact cold owned runtime scope:

```sh
python3 labs/open-compute/trial.py destroy --state /home/trial-user/oc-state
```

Expected: destroyed=true, `.open-compute` absent; private manifest/state and cache
remain for diagnosis. Repeated destroy refuses. Do not upload the state manifest,
keys, configs, database or raw runtime files. A lost response to a write may mean
the operation committed: inspect status/read; do not automatically retry it.

Dirty or incomplete state, stale sockets, altered ownership, uncertain Workflow
mutation, forced shutdown or surviving processes fail closed. Retain everything
and inspect within the approved environment; never edit clean=true, delete a
marker/socket to bypass admission, or run another init over existing state.
No automatic orphan recovery is implemented.

For a finite independent rehearsal, use `make -C labs/open-compute integration-trial`
on a separate fresh non-root account. This runs the above separate-process
sequence, including duplicate/conflicting inputs and explicit cold disposal.
CI uploads only its bounded sanitized report; actual results are in STATUS.

## Cleanup after a disposable M1–M6 runner

For the disposable integration runners, normal completion stops all owned processes and removes only the scope created
by that invocation, after checking its marker and identity. The downloaded
binary and sanitized report remain. If normal shutdown requires forced cleanup,
the integration fails even when cleanup eventually succeeds. A changed marker,
changed scope identity, or surviving process prevents deletion.

M2 has an additional failure rule: final cleanup stops the runtime but **never
deletes a still-present original source scope**, including an early setup,
seeding or backup verification failure. Only the recovery operation can remove
that source, immediately after its complete package/source verification gates.
If a later package recheck fails, an earlier successful check cannot authorize
source deletion through cleanup. The report records
`source_preserved: true`. Private partial backup/staging data can still be
removed after checking ownership. Final cleanup cannot bypass the
verify-before-delete gate; it can remove the successfully transferred fresh
scope after process exit. Use a new disposable environment for the next run;
an existing preserved scope is never adopted by a retry.

M2 final deletion of its restored scope and removal of its private backup/staging
each have a separate 30-second total deadline, run sequentially after owned
process exit. These cleanup budgets do not extend the earlier 120-second
recovery budget or reset the Workflow's persisted five-minute event timeout.

For failures, inspect `phase`, `error`, `cleanup_error` when present, acceptance
results, and bounded sanitized diagnostics in the report. A nonzero exit is a
failed real integration; an unavailable runtime is never called a passing skip.
Do not upload the scope, database directory, raw configuration, keys, or tokens.
If cleanup was refused, use the report's process identities and the local scope
ownership marker to investigate within the disposable environment; the harness
does not adopt an old run on retry.

HTTP operations have a total wall-clock deadline across headers and body, in
addition to the socket inactivity timeout. Unknown process identities, unreadable
process metadata, or incomplete log draining fail cleanup verification; they are
never interpreted as proof that a process exited.

M4 runs in a separate fresh non-root Python 3.11 CI job with a ten-minute job
budget; only its explicitly selected sanitized report is uploaded for seven
days. No filesystem inventory, raw stat, database, object, key or config is
an artifact.

The [scoped workflow](../../../.github/workflows/open-compute-ci.yml) runs M1,
M2 and M3 sequentially on a fresh non-root runner, requiring each invocation to clean its scope.
It selects Python 3.11 explicitly and installs no application packages.
It retains only the three explicitly selected sanitized report files for seven
days. Its job log also contains the reports. No backup directory or inventory
is selected for upload, including failed runs. Local success is not
assumed from offline tests; the exact delivered evidence is linked in STATUS.

## What this result means

M1 is a normal daemon restart of one committed synthetic workflow. M2 separately
tests complete Local cold restore after source removal on the same runner/path/UID.
Neither establishes cross-host recovery, power-loss consistency, upgrade safety,
HA, general exactly-once effects, performance, all Workers API compatibility, or
isolation for hostile tenant code. Only this trusted fixture is submitted, and it makes no
outbound application requests. Upstream Worker fetch can reach host-routable
networks; loopback ingress alone does not change that boundary.
M3 supplies bounded observations for four synthetic windows and preserves those
functional assertions; its sampling limits do not establish capacity or tenant isolation.

M4 supplies bounded cold regular-file metadata endpoints for this fixed batch.
Signed changes also include restart/platform/completion effects; they do not
establish a long-term slope, reclaimability, storage quota or physical capacity.

M5 adds only checkpoint SIGKILL evidence for observed authorized generations.
Power loss, in-flight effects, portability, upgrades and isolation remain
separate gates even when all M5 assertions pass.
