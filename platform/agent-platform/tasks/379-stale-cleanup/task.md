# Issue379 — manual stale binding cleanup

Implement the bounded STALE01–03 contract in SUCCESS and
[STALE-CLEANUP](../../docs/STALE-CLEANUP.md). Independent T093 review accepted
the Phase A contract after correcting legacy journal enrollment; root accepts
that design only. This committed contract precedes the actual missing-behavior
RED and implementation. Root owns runtime verification and normal PR delivery.

Scope: one explicitly approved terminal binding, existing lease/generation and
private journal authority, one release request per attempt, preserved original
operation, and existing recovery alone confirming cleanup/releasing capacity.
No new schema or backup pin; no automatic collector, unknown resource deletion,
host residue removal, live VM/provider operation, deployment or full M4 claim.

Require focused real PostgreSQL/HTTP failure, ownership/concurrency/crash/replay
and native restore evidence, independent implementation review and normal required
CI. Preserve every initial failure. See the [task board](../../docs/tasks/BOARD.md).
