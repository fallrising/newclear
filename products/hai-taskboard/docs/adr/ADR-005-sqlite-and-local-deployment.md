# ADR-005: SQLite driver, artifact storage and local deployment

Status: Accepted at G0 for P0-A
Date: 2026-09-05

## Context

P0-A needs transactions, foreign keys, WAL/concurrency behavior, online backup, deterministic tests
and a reproducible Go 1.27 build. Driver and engine behavior cannot be selected by familiarity alone.

## Decision

Select `modernc.org/sqlite@v1.58.0` under Go 1.27.1. The bounded T-004 spike verified its
actual linked SQLite 3.53.4/source ID, which is newer than the 3.51.3 WAL-reset-fix floor, and passed
foreign-key, transactional-DDL, WAL/FULL/busy-timeout, concurrent-writer, cancellation,
extension-denial, `VACUUM INTO` restore, repeated, race and `CGO_ENABLED=0` tests on Linux/amd64.

The alternative `github.com/mattn/go-sqlite3@v1.14.52` passed the same functional and race cases with
the same SQLite engine, but requires CGO/C compiler/ABI release evidence. Pure-Go portability is the
deciding P0-A factor; it is not a claim of universal performance or architecture support.

Use a controlled absolute `file:` URI equivalent to:

```text
file:/absolute/state/taskboard.db?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)
```

Startup MUST read back `foreign_keys=1`, `journal_mode=wal`, `synchronous=2`, `busy_timeout=5000`,
record module/engine/source versions and reject an engine below 3.51.3. Application writes are
serialized and use explicit immediate transactions; busy failure is typed and bounded, never retried
indefinitely. Extension loading and request-supplied PRAGMA/DSN fragments remain disabled.

Backup uses a writer-quiesced, parameter-bound `VACUUM INTO` into a unique mode-0700 same-filesystem
directory, followed by mode-0600, fsync, integrity/FK/schema/material verification, digest manifest,
parent-directory fsync and atomic immutable publication. Restore begins dispatch-disabled, verifies
all bytes, installs into an empty location, advances restore generation and stream epoch, reconciles
unknown work without replay and only then permits explicit dispatch enablement.

## Selection criteria

The chosen driver/engine MUST demonstrate, in the pinned target environment:

1. Go 1.27 compatibility and maintained release/security posture;
2. foreign key enforcement and transactional migrations;
3. predictable WAL, busy timeout, cancellation and concurrent reader/writer behavior;
4. online backup or a documented quiesced-backup protocol;
5. race-detector and failure-injection compatibility;
6. acceptable CGO/container portability trade-off;
7. license compatibility with this MIT component.

Large artifacts use a same-filesystem digest-addressed store with atomic rename. The server binds
loopback by default. No deployment claim is accepted until backup/restore and corruption tests pass.

## Evidence

- T-004 report SHA-256:
  `c0cc1978642d671e0692e735b4981faf86df1da9986f279e01711522389d58ea`.
- Both normal suites, ten repeats and three race repeats passed; modernc also passed CGO-off.
- The retained initial exit-137 run was an invalid temporary harness deadlock and is not relabelled as
  driver evidence; corrected isolated/repeated runs passed.
- Linux/amd64 only. Product disk-full/migration-kill/manifest-crash/generation-rotation and other
  architectures remain NotRun and mandatory where applicable.

## Consequences

- One larger pure-Go transitive dependency graph is accepted in exchange for a hermetic CGO-free P0
  build; every update repeats engine, license, vulnerability, functional and race evidence.
- `VACUUM INTO` is a logical snapshot, not a byte copy of live DB/WAL/SHM files.
- The 5-second busy timeout is a maximum wait, not an availability guarantee.
- Product persistence remains blocked until G0 accepts this contract; production acceptance remains
  blocked until the listed failure-injection and restore cases actually pass.
