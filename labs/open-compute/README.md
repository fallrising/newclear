# open-compute runtime lab

> **Portfolio: A — active experiment.** [Documentation policy](../../docs/portfolio-doc-tiers.md).
> The current milestone evaluates a pinned upstream release with synthetic data.

An SDD-driven experiment for running a Workers-style platform on hardware you
control. It uses the original [open-compute](https://github.com/elliothux/open-compute)
`v0.2.4` release and a small first-party operational harness.

The useful question is whether deployed code and durable state work through an
operator lifecycle. M1 runs a real **Worker → D1 → Workflow event wait
→ normal daemon restart → event completion** path. M2 extends the experiment to
**complete Local cold backup → actual source removal → clean-state restore**,
including a binary R2 object and the original waiting Workflow. A dedicated
callback counter makes an unexpected replay visible. Actual executed results
and their limits are recorded in [the status document](docs/STATUS.md).
M3 adds four fixed idle/read windows around normal restart to observe the
daemon and its discovered descendants' RSS and own CPU time. Its figures describe
this synthetic workload and sampled coverage; they do not set a capacity limit.
M4 adds three cold scope snapshots around sixteen fixed D1 jobs and the original
Workflow completion. It includes generated OCR/transient files and separates
logical sizes from allocated blocks, with observed hardlinks counted once.

M5 adds SIGKILL of the daemon and its observed owned live process generations
at a publicly committed waiting checkpoint, then GET-only original state
readback before original Workflow completion. The runner/kernel/filesystem
remain alive; this tests one process interruption point with the same UID/path.

## Current scope

| Included in M1 | Evidence boundary |
| --- | --- |
| Pinned Linux x64 release with size and SHA256 verification | Identifies the executed artifact; version text alone is insufficient |
| Fresh non-root user scope and owned foreground daemon | Does not install a machine service or expose a public listener |
| Real v4 deployment, Worker request, and D1 write/read | Exercises this API subset, not every Workers binding |
| Duplicate submission of one synthetic job | Tests application-level submission idempotency |
| Same Workflow ID and data across SIGTERM restart | Tests normal daemon recovery, not SIGKILL, cold restore, HA or upgrade |
| Counter and nonce retained through completion | Tests replay of this committed step, not external exactly-once effects |
| Offline harness checks and a real-runtime CI gate | Test doubles cannot establish upstream runtime success |

| Added in M2 | Evidence boundary |
| --- | --- |
| Complete owned state, configuration, keys and Local object backup | Tests this fixed fixture; excludes only enumerated transient paths and binary-derived OCR assets |
| Quiescence, package integrity and actual source removal | A saved snapshot reference or an old data-directory fallback cannot pass |
| Fresh directory tree and new daemon at the original path and UID | Same disposable runner; cross-host, OS and arbitrary path relocation remain unverified |
| Original deployment/version/bindings and D1 state recovered | Restore cannot setup, redeploy, recreate resources or reseed data |
| R2 bytes, metadata, etag, version and timestamp retained | Tests recovery of one binary object, not general R2 API parity |
| Same waiting Workflow completes with counter 1 and unchanged nonce | Tests this committed step through cold restore, not external exactly-once effects |

| Added in M3 | Evidence boundary |
| --- | --- |
| Four finite idle/read windows across normal restart | One trusted Worker/D1/Workflow fixture, sixteen serial GETs total |
| PID/start-time generation tracking and bounded resource acquisition | Observed descendants only; short-lived or undiscovered processes may be missed |
| Maximum sampled aggregate RSS and paired own CPU ticks | RSS can count shared pages repeatedly; scan peaks and CPU intervals have sampling gaps |
| Separate sanitized resource report and real-runtime gate | Includes units, workload, scan counts/gaps and explicit coverage limits; no capacity or isolation claim |

| Added in M4 | Evidence boundary |
| --- | --- |
| Three cold scope metadata snapshots under existing runtime locks | Regular-file bytes only; includes OCR/transient content, excludes directory/socket blocks |
| Sixteen fixed jobs, duplicate submissions and same-data readback | Signed endpoint changes mix writes, restarts and platform effects; no per-job attribution |
| Logical bytes and st_blocks × 512, observed inode aliases deduplicated | Physical extent sharing, compression, peaks and long-term growth remain unknown |
| Separate sanitized storage report and fresh CI job | Original Workflow/state/normal cleanup remain controls; no capacity/retention/adoption guarantee |

This is a bounded lab around upstream software. It does not accept arbitrary
user code, provide a Linux command sandbox, or manage production hosts. The
host, workload catalog, and runtime remain separate authorities; the SDD records
what a later adapter would need.

## Start here

- [M1 SDD and acceptance IDs](docs/SDD.md) — normal daemon restart contract.
- [M2 SDD and acceptance IDs](docs/SDD-M2.md) — full cold backup and clean-state restore contract.
- [M3 SDD and acceptance IDs](docs/SDD-M3.md) — bounded observed process-tree resources.
- [M4 SDD and acceptance IDs](docs/SDD-M4.md) — bounded cold disk footprint and fixed D1 writes.
- [Quickstart](docs/quickstart.md) — one reproducible operator path and prerequisites.
- [Status and evidence](docs/STATUS.md) — actual commands, results and limitations.
- [Upstream lock](upstream.lock.json) — release, source and binary checksum.

```sh
make -C labs/open-compute check
make -C labs/open-compute integration
make -C labs/open-compute integration-restore
make -C labs/open-compute integration-resources
make -C labs/open-compute integration-storage
```

The integration command requires **Linux x64, a real non-root account, and a
fresh disposable home with no existing `.open-compute` scope**. It downloads
the pinned release from GitHub. The harness refuses to overwrite an existing
scope or bypass upstream's non-root requirement. Read the quickstart first.
M2 removes only the synthetic scope created by that invocation, after verifying
its complete backup, and restores solely from that backup. Secret-bearing backup
files remain private temporary data; only the sanitized report is retained.

Only the checked-in trusted fixture is executed. Upstream allows outbound
connections to destinations reachable from the host, including private and
loopback addresses; a local ingress listener is not per-tenant network isolation.
See the [pinned security policy](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/SECURITY.md).

## Evaluation after the lab

These experiments inform an adoption decision. Before operational use, evaluate
the actual application's API subset, recovery on a different host, production
backup retention, version upgrades, resources under the real application's load, and appropriate
host/network isolation. Those are separate gates; an advertised idle-memory
number is not a capacity plan. The lab's restore command is a synthetic
experiment, not a general-purpose production backup utility.

## License

The harness, fixture and lab documentation use this repository's MIT license.
Upstream open-compute is Apache-2.0 with its own notices. The lab downloads an
original release for local execution; upstream source and binaries are not
vendored here.

## Checkpoint SIGKILL experiment (M5)

The [M5 contract](docs/SDD-M5.md) is committed before implementation. Follow the
[quickstart](docs/quickstart.md) on a fresh disposable non-root account and run
`make -C labs/open-compute integration-crash`. Each frozen live generation must
receive SIGKILL after immediate PID/start validation; the daemon is first so
it cannot intentionally respawn a child. A vanished child before its required
signal fails the stimulus. All retained observed generations must be nonlive
and observers closed before a new original daemon may start over the same
owned authority. GET-only deployment/binding, D1 row and waiting Workflow checks
precede approval. Final shutdown remains normal SIGTERM.

The separate bounded sanitized report records M5-01 through M5-05, exact signal
receipts and original counter/nonce controls. Only actual execution linked from
STATUS supports a pass. Sequential observed-generation termination does not
establish atomic whole-tree crash, power loss, arbitrary in-flight replay,
external exactly-once effects, unobserved descendant coverage or adoption.

## Controlled Workflow retries (M6)

The [M6 contract](docs/SDD-M6.md) defines three cases in a separate trusted
fixture: a post-effect failure with unguarded D1 writes, the same failure with
a stable operation key, and exhausted retries. Each uses one additional attempt.
Follow the [quickstart](docs/quickstart.md), then run
`make -C labs/open-compute integration-retry`. Actual results belong in
[STATUS](docs/STATUS.md); a contract or offline test alone is not runtime evidence.
The synthetic effect is a local D1 row. This does not test external exactly-once
effects, process crashes between statements, concurrency or production adoption.

## Retained manual operator trial

The separate M7 operator path uses `trial.py` initialization, a foreground owner
and finite commands from another terminal. Normal stop retains state; explicit
cold disposal is separate. See [quickstart section9](docs/quickstart.md#9-operate-a-retained-manual-trial-m7)
and [SDD-M7](docs/SDD-M7.md). `make integration-trial` rehearses separate-process
operation on a fresh non-root environment. This does not install a test machine
or service; [STATUS](docs/STATUS.md) distinguishes executed evidence and limits.
