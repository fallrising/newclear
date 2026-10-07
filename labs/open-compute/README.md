# open-compute runtime lab

> **Portfolio: A — active experiment.** [Documentation policy](../../docs/portfolio-doc-tiers.md).
> The current milestone evaluates a pinned upstream release with synthetic data.

An SDD-driven experiment for running a Workers-style platform on hardware you
control. It uses the original [open-compute](https://github.com/elliothux/open-compute)
`v0.2.4` release and a small first-party operational harness.

The useful question is whether deployed code and durable state work through an
operator lifecycle. M1 therefore runs a real **Worker → D1 → Workflow event wait
→ normal daemon restart → event completion** path. A dedicated callback counter
makes an unexpected replay visible.

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

This is a bounded lab around upstream software. It does not accept arbitrary
user code, provide a Linux command sandbox, or manage production hosts. The
host, workload catalog, and runtime remain separate authorities; the SDD records
what a later adapter would need.

## Start here

- [SDD and acceptance IDs](docs/SDD.md) — contract committed before implementation.
- [Quickstart](docs/quickstart.md) — one reproducible operator path and prerequisites.
- [Status and evidence](docs/STATUS.md) — actual commands, results and limitations.
- [Upstream lock](upstream.lock.json) — release, source and binary checksum.

```sh
make -C labs/open-compute check
make -C labs/open-compute integration
```

The integration command requires **Linux x64, a real non-root account, and a
fresh disposable home with no existing `.open-compute` scope**. It downloads
the pinned release from GitHub. The harness refuses to overwrite an existing
scope or bypass upstream's non-root requirement. Read the quickstart first.

Only the checked-in trusted fixture is executed. Upstream allows outbound
connections to destinations reachable from the host, including private and
loopback addresses; a local ingress listener is not per-tenant network isolation.
See the [pinned security policy](https://github.com/elliothux/open-compute/blob/73efa56a1b1ad51a4519b2253ffaa499cb29fb2d/SECURITY.md).

## Evaluation after the first path

M1 is the beginning of an adoption decision. Before operational use, evaluate
the actual application's API subset, complete cold backup and restore, version
upgrades, total process-tree resources, and appropriate host/network isolation.
Those are separate gates; an advertised idle-memory number is not a capacity
plan. Current completion and gaps are recorded in the status document.

## License

The harness, fixture and lab documentation use this repository's MIT license.
Upstream open-compute is Apache-2.0 with its own notices. The lab downloads an
original release for local execution; upstream source and binaries are not
vendored here.
