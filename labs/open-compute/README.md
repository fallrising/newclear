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

This is a bounded lab around upstream software. It does not accept arbitrary
user code, provide a Linux command sandbox, or manage production hosts. The
host, workload catalog, and runtime remain separate authorities; the SDD records
what a later adapter would need.

## Start here

- [M1 SDD and acceptance IDs](docs/SDD.md) — normal daemon restart contract.
- [M2 SDD and acceptance IDs](docs/SDD-M2.md) — full cold backup and clean-state restore contract.
- [Quickstart](docs/quickstart.md) — one reproducible operator path and prerequisites.
- [Status and evidence](docs/STATUS.md) — actual commands, results and limitations.
- [Upstream lock](upstream.lock.json) — release, source and binary checksum.

```sh
make -C labs/open-compute check
make -C labs/open-compute integration
make -C labs/open-compute integration-restore
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
backup retention, version upgrades, total process-tree resources, and appropriate
host/network isolation. Those are separate gates; an advertised idle-memory
number is not a capacity plan. The lab's restore command is a synthetic
experiment, not a general-purpose production backup utility.

## License

The harness, fixture and lab documentation use this repository's MIT license.
Upstream open-compute is Apache-2.0 with its own notices. The lab downloads an
original release for local execution; upstream source and binaries are not
vendored here.
