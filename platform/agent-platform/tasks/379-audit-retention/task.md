# Issue379 — manual audit retention

Implement the existing SDD12 minimum90-day audit policy as explicit bounded preview/apply, preserving independent control/recovery/approval/replay state. Contract and AUD01–04 in SUCCESS precede implementation; independent T090 accepted PhaseA. Root owns verification and normal PR delivery.

Bounded scope: audit GC module/CLI, append-only018 migration/approved independent PostgreSQL18 schema pin, exact approval/receipt/minimal tombstone guards, focused real PostgreSQL and native restore evidence. No scheduler, audit UI, live data pruning, VM/provider operation, new dependency, deployment or fullM4 claim. Retain all earlier failures and exact source provenance.

See [AUDIT-RETENTION](../../docs/AUDIT-RETENTION.md) for exact bounds/policy/negative tests and [task board](../../docs/tasks/BOARD.md). Normal required CI/review must pass before merge; report actual local and hosted results separately.
