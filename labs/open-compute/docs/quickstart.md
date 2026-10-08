# Run the runtime experiments

This is the single operator path for M1 in [SDD.md](SDD.md) and the M2 cold
restore experiment in [SDD-M2.md](SDD-M2.md). It
downloads the original **v0.2.4 Linux x64** release, verifies its pinned size and
SHA256, and exercises a synthetic Worker, D1 database, and Workflow. The harness
uses Python's standard library and requires Python 3.10 or newer, Git, and make.

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
component's ephemeral GitHub Actions runner. The current authoring container
runs as root; its real-runtime command is expected to **fail preflight**. This
is an environment limitation, not passing runtime evidence.

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

## Cleanup and a failed run

Normal completion stops all owned processes and removes only the scope created
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

The [scoped workflow](../../../.github/workflows/open-compute-ci.yml) runs M1 and
then M2 on a fresh non-root runner, requiring each invocation to clean its scope.
It retains only the two explicitly selected sanitized report files for seven
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
