# ADR-007 — M0 toolchain and durability acceptance platform

- Status: accepted
- Date: 2026-09-16
- Applies to: M0 and later durability evidence

## Decision

mkfk pins the Go 1.27 language line and the Go 1.27.1 toolchain in `go.mod`. Go 1.27.1 was the current supported patch when M0 was created. The support check uses the official [Go release history](https://go.dev/doc/devel/release), whose policy supports a major release until two newer major releases exist.

The minimum correctness test platform is:

- Linux kernel 5.10 or newer on `amd64` or `arm64`;
- a local ext4 or XFS filesystem on a block device;
- working `fsync(2)` for files, directory `fsync(2)`, atomic same-filesystem `rename(2)`, and advisory file locks;
- three distinct data directories for a three-process cluster test.

tmpfs may run non-durability unit tests but is not acceptable persistence evidence. NFS, SMB, FUSE, overlay/container writable layers, and network block devices require separate filesystem-specific evidence before durability claims. A `SIGKILL` restart test is crash evidence, not physical power-loss evidence.

M0 uses the standard library for production contracts. `github.com/santhosh-tekuri/jsonschema/v6` is pinned as a test-only dependency so examples and counterexamples execute against the published Draft 2020-12 schemas.

## Consequences

- CI or local evidence must report the exact Go patch, kernel, architecture, and filesystem.
- A newer Go patch is a reviewed toolchain update, not an implicit ambient upgrade.
- Storage tests must inject write/sync/rename failures and must not infer durability from an in-memory fake.
- M1 must provide the real Linux filesystem adapter and verify its sync ordering on an accepted filesystem.

## Rejected alternatives

- Using whichever `go` happens to be on `PATH`: this makes evidence irreproducible.
- Treating container overlay storage or tmpfs as durability acceptance: neither establishes the required host filesystem contract.
- Adding a broker executable in M0: it would imply service behavior before storage and consensus milestones exist.
