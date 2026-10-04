---
id: ACCEPT-T040A-DESIGN
subject: T040A design and blocked T040 decomposition
reviewer_context: fresh-context-gpt-6-astra
decision: accepted
date: 2026-10-04
---

# Decision

**T040A ACCEPTED FOR DESIGN ONLY.** The pure v1 command prerequisite may become Ready.
Fresh independent review found A01–A09 coherent with current T010/T020 and their private reducer
trust. No command implementation or runtime acceptance is claimed. Parent T040 and proposed
B–I seeds remain Blocked; ADR-0007 remains a draft direction, not accepted schema/clock/recovery
semantics. Their rows are planning seeds and require complete task/spec files before advancement.

# Reviewed Boundary

[SPEC-T040A](../specs/SPEC-T040A-command-decision.md) defines three typed commands, exact
77/96-byte identity covering every request field, a complete 27-cell state/command table plus
three empty-state cases, 11 bounded rejection variants, and deterministic zero/one v1-event
intent with explicit metadata. The function performs no I/O, identifier generation, clock read,
authorization, receipt write or backend action. WaitingApproval cancellation returns the explicit
unsupported rejection; it does not fabricate approval denial or change the accepted v1 reducer.

The reviewer inspected TD §§4.2/4.4/4.7/8–11/16.3, current domain IDs/events/reducer, exact-v2
store admission and cancelled-future behavior, the separate P0 runtime, A specification/task,
draft ADR and the proposed parent graph. A requires only already Accepted T010/T020.

# Findings and Resolution

Two test-oracle wording issues were repaired before acceptance: precedence tests combine every
co-reachable pair and document unreachable pairs, rather than demanding impossible simultaneous
states; sequence-u64::MAX setup remains in an in-crate cfg(test) unit seam, executed by the full
domain suite, with no public reducer constructor. Public integration cases use legal histories.
Receipt roadmap wording now identifies immutable durable command records without implying
permission to execute an external effect.

# Verification Actually Performed

- Independent document/source audit of all A01–A09 clauses, exact canonical layout, every
  state/command cell and rejection, metadata, no-op cancellation and authority limits — passed.
- Orchestrator document validator: nine clauses mapped to 11 unique future names; all 27 matrix
  cells match the current nine status variants; three empty cases; byte-size arithmetic and
  accepted dependency metadata — passed.
- Local Markdown links and proposed task dependency audit — passed.
- SHA-256 preservation audit of 105 Rust source, manifest/lock and historical acceptance files — passed.
- `git diff --check` — passed.

No new Rust skeleton, command-decision runtime test or actor integration was written or run.
Listed implementation commands in SPEC-T040A remain future requirements. Hosted regression CI
is a separate delivery gate and cannot substitute for those future behavior tests.

# Remaining Runtime and Architecture Gates

A must first produce all named compiling RED skeletons, then substantive oracles, domain and
workspace regression gates, rustdoc projection and fresh runtime acceptance. The project-wide
automated rustdoc/spec drift checker remains a documented tooling gap.

The [parent roadmap](../specs/SPEC-T040-session-actor.md) retains explicit owned gaps for versioned
withdrawal, managed schema, trusted lease clock/fencing, immutable receipts, atomic commit,
pinned startup, bounded mailbox/cancellation, audit provenance and effect reconciliation. Exact
same-key receipt replay must not re-execute effects, and a missing observation does not prove an
in-flight writer cannot later commit. No external effect may bypass receiver fencing or uncertain
outcome reconciliation. This design record grants no readiness to those later contracts.
