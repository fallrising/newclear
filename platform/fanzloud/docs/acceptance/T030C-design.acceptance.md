---
id: ACCEPT-T030C-DESIGN
subject: T030C design
reviewer_context: fresh-context-gpt-6-astra
decision: accepted
date: 2026-10-04
---

# Decision

**Accepted for design only.** Fresh-context GPT-6 Astra review found no blocking architecture or
contract gap in [SPEC-T030C](../specs/SPEC-T030C-sqlite-snapshot-load.md). T030C may become Ready
for test-first implementation. This report does not accept C runtime or parent T030 composition.

# Reviewed Boundary

The review started from TD §§4.6/8/10/11, accepted ADR-0005, T030C/T030 tasks, SPEC-T030D S01–S16
and its ownership matrix, historical D design/runtime acceptance, and actual event-store/domain
helpers before reviewing C01–C12. The contract covers read-only/no-create admission, one pinned
transaction, exact v2 identity, structural-key checks, head-before-value error precedence,
selective malformed-value misses, bounded 1..S reduction, all-field equality, replayed projection
return, caller-owned continuation, cancellation/restart and E0 exit fingerprints.

Cache sequence S<=4096 remains usable behind larger full-u64 head H. Neither typed wrapper nor
stored bytes grants restore authority. Only private InvalidSnapshotCache becomes a miss;
observed structural/storage/history errors retain their safe types. No new migration, dependency,
domain import or P0 integration is proposed.

# Findings and Resolution

One non-blocking wording issue was repaired before implementation: unchanged application data
alone cannot guarantee identical Busy, Storage or WorkerUnavailable outcomes. The Idempotency
section now distinguishes equal deterministic dispositions under successful read conditions
from environmental availability. The existing fake-provider P0 E2E command is named explicitly.
No security, atomicity or retry semantics remain undefined for this boundary.

# Verification Actually Performed

- Reviewed all 12 clauses, precondition/error tables, applicable archetype questions and helper signatures.
- Independently checked all 13 C-only/shared-C names from D plus six additional public E0 names,
  for 19 unique obligations with substantive oracles; local references resolved.
- Inspected read-only/no-create connection flags, same-transaction verifier, gated cache/head SQL,
  selective error mapping opportunities and private domain fields.
- `git diff --check` passed for the draft tree. No C runtime test is claimed executed here.

# Remaining Runtime and Parent Gates

All 19 C names must run as compiling fixed failures before production code, then pass with
substantive public API assertions. Required focused/workspace/Node/fake-provider E2E/fmt/Clippy/
build/dependency gates and a fresh runtime review follow. Parent composition requires every child
accepted plus its separate composition tests/review. Historical acceptance reports stay unchanged.

The inherited tradeoffs remain explicit: full prefix verification does not accelerate startup;
metadata key scanning and total operation time are not bounded by4096; no full post-open history
integrity claim or public reducer restore is introduced. Project-wide automated rustdoc/spec
drift tooling remains an existing documented gap; this review does not claim it is implemented.
