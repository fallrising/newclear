# ADR-002: Candidate/evidence model and subject-bound completion

Status: Accepted at G0 for P0-A
Date: 2026-09-05

## Context

A run ending successfully does not prove that its output satisfies current acceptance criteria. A
plain evidence verdict is unsafe when specifications, dependencies, recipes or candidates change.

## Decision

Keep WorkItem, Run, Candidate, Review, Evidence, Approval and CompletionRecord separate. Immutable
Evidence binds the exact candidate digest, Run input digest, complete required AC revision set,
accepted dependency graph revision, policy version, verification recipe/environment fingerprint and
verifier identity/class. Review and Approval bind the same exact subject.

Only `CompleteWorkItem` may enter Done. It evaluates the complete predicate inside the same
transaction that inserts an immutable CompletionRecord and changes phase. Missing, Failed, Skipped,
NotRun, Unknown, stale or non-independent required evidence rejects completion with stable reasons.

## Consequences

- Old evidence remains historically true but becomes inapplicable when its subject changes.
- UI can explain exactly which part of the gate is unmet.
- Tests must include negative completion and TOCTOU cases, not only a happy path.

## Rejected alternatives

- `Run.Succeeded => WorkItem.Done`.
- Mutable evidence rows whose subject or verdict can be rewritten.
- Human approval of a title or WorkItem ID without a subject digest.
