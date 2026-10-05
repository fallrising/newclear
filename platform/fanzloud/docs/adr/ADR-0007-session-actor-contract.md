---
id: ADR-0007
title: Staged session actor prerequisites and fenced managed persistence
status: draft
date: 2026-10-04
---

# Context

Accepted [T020](../specs/SPEC-T020-events-reducer.md) supplies a pure v1 reducer.
Accepted [T030](../acceptance/T030.acceptance.md) supplies exact schema-v2 append/replay/cache
operations, with no receipts, leases or actor. Accepted T040A now supplies typed command envelopes,
ActorRef labels and a pure v1 planner; P1 actor ports remain absent. Current `P0SessionRuntime` is provider-specific and
process-lifetime; its protocol/credential boundary cannot establish P1 crash durability.
TD §§4.7/16.3 require more prerequisites than the current T040→T020 seed edge records.

# Proposed Decision

[T040A](../specs/SPEC-T040A-command-decision.md) is independently
[runtime Accepted](../acceptance/T040A.acceptance.md): pure v1 intent decision, accepted
T010/T020 dependencies and no architecture change. Its acceptance does not accept this draft
or unlock implementation of the blocked roadmap below.

1. Preserve exact v1 events/reducer behavior. WaitingApproval cancellation requires a separately
   specified versioned withdrawal event/reducer amendment; do not fabricate ApprovalResolved,
   human denial or authorization. INV-003/004/010 remain intact. The amendment must version
   payload decoding and cache compatibility before any implementation.
2. Introduce an opt-in managed store with exact new schema identity, tentatively version3, only
   after C's separate contract is accepted. Preserve v2 source/acceptance as historical. Require
   per-operation identity checks so old handles reject managed-store mutations; expose no
   unfenced append/cache-write route on the managed type. Exact DDL/upgrade is still blocked.
3. Serialize fenced event+command-outcome receipt in one E1 transaction. Append head CAS is not
   owner fencing. Exact normalized envelope equality includes all request fields and excludes
   transient owner/token. Receipts are durable records, not discardable caches; malformed records
   fail closed. Observation is a separate E0 boundary and never executes an external effect.
4. Store deterministic accepted/rejected command outcomes immutably, with finite exact codecs
   and explicit retention/capacity policy before Ready. Existing equal-key outcomes replay before
   head/version/lifecycle/lease checks. Transport/storage/ownership failures produce no new receipt.
   An absent observation cannot prove an in-flight blocking transaction will not later commit.
5. Enforce lease token ownership inside every durable mutation transaction and at each external
   receiver admission boundary. Fresh owner-per-incarnation identity differs from monotonic token;
   token never resets on release, restart or boot. A local mutex or preflight Boolean is insufficient.
6. Proposed local clock authority uses Linux CLOCK_BOOTTIME plus kernel boot UUID and trusted
   time-namespace identity. BOOTTIME includes suspend and is nonsettable; it is also virtualized
   by time namespaces. Unavailable/changed authority must fail closed; same-boot namespace
   change cannot silently expire another live owner. Boot change requires explicit locked reopen.
   The exact persisted authority/overflow/renewal/expiry contract remains D-owned, blocked.
   Primary references: [clock_gettime](https://man7.org/linux/man-pages/man2/clock_gettime.2.html),
   [kernel random/boot_id](https://docs.kernel.org/admin-guide/sysctl/kernel.html#random),
   [time namespaces](https://man7.org/linux/man-pages/man7/time_namespaces.7.html).
7. Define lease admission at an explicit serialized transaction checkpoint, with final validity
   recheck before COMMIT and no possible newer token commit while the writer lock is held.
   Do not promise already admitted writes/effects stop at the wall-clock expiry instant.
   External Started effects can outlive a lease; fencing cannot undo them. Receiver contracts
   and query-before-retry reconciliation remain mandatory, including no automatic OutcomeUnknown retry.

# Consequences, Alternatives and Acceptance

The first bounded slice is testable without SQLite or providers. Subsequent units separate
E0 observation/decision, E1 schema/lease/receipt/dispatch and effect-specific E2/E3 contracts.
Unfenced existing append, process-local deduplication, automatic uncertain-effect replay and
synthetic approval denial do not satisfy TD invariants. No approved invariant is weakened.
This ADR is a direction proposal, not accepted schema/clock/recovery semantics or runtime evidence.
Root must project any accepted amendment into TD before affected production work; future workers
must remain inside their separately assigned scope and preserve historical acceptance.
