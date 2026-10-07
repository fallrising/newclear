# Run the M1 runtime experiment

This is the single operator path for the experiment in [SDD.md](SDD.md). It
downloads the original **v0.2.4 Linux x64** release, verifies its pinned size and
SHA256, and exercises a synthetic Worker, D1 database, and Workflow. The harness
uses Python's standard library and requires Python 3.10 or newer plus Git.

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
`127.0.0.1`. Use `python3 labs/open-compute/lab.py preflight --port 8877` to test
a different unprivileged loopback port.

## 3. Run the real experiment

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

The report directory must be new. Each invocation creates its own empty user
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

## Cleanup and a failed run

Normal completion stops all owned processes and removes only the scope created
by that invocation, after checking its marker and identity. The downloaded
binary and sanitized report remain. If normal shutdown requires forced cleanup,
the integration fails even when cleanup eventually succeeds. A changed marker,
changed scope identity, or surviving process prevents deletion.

For failures, inspect `phase`, `error`, `cleanup_error` when present, acceptance
results, and bounded sanitized diagnostics in the report. A nonzero exit is a
failed real integration; an unavailable runtime is never called a passing skip.
Do not upload the scope, database directory, raw configuration, keys, or tokens.
If cleanup was refused, use the report's process identities and the local scope
ownership marker to investigate within the disposable environment; the harness
does not adopt an old run on retry.

The [scoped workflow](../../../.github/workflows/open-compute-ci.yml) runs these
same commands on a fresh non-root runner and retains only the sanitized report
for seven days. Its job log also contains the report. Local success is not
assumed from offline tests; the exact delivered evidence is linked in STATUS.

## What this result means

This is a normal daemon restart of one committed synthetic workflow. It does
not prove crash recovery, full backup/restore, upgrade safety, HA, general
exactly-once effects, performance, all Workers API compatibility, or isolation
for hostile tenant code. Only this trusted fixture is submitted, and it makes no
outbound application requests. Upstream Worker fetch can reach host-routable
networks; loopback ingress alone does not change that boundary.
