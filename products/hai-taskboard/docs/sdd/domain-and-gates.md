# Mini-SDD: Domain and completion gates

Status: Accepted at G0 for P0-A
Parent: `../SDD.md` clauses HAI-DOMAIN, HAI-STATE and HAI-DONE

## Purpose

Freeze the smallest domain vocabulary and command guards required for a Fake-only vertical slice.
Transport, SQL schema and UI representations may add fields but cannot collapse these identities.

## Subject identity

`CompletionSubjectV1` is the canonical serialization of:

```text
project_id
work_item_id
work_item_version
candidate_id + candidate_digest
run_id + run_input_digest
ordered required (ac_id, ac_revision_digest)
accepted_graph_revision_digest
policy_revision_digest
completion_recipe_digest
integration_base_digest (when applicable)
```

The subject digest is SHA-256 over canonical JSON: UTF-8, sorted object keys, arrays already sorted by
stable identity, no insignificant whitespace, timestamps normalized to UTC RFC 3339 nanoseconds.
Unknown fields are rejected at command boundaries for V1 rather than silently excluded from signing.

## Commands

All commands carry `command_id`, `idempotency_key`, `actor_id`, `expected_version` and `issued_at`.
The application resolves actor permissions, canonicalizes the request, and opens one transaction.

| Command | Guard summary | Durable result |
| --- | --- | --- |
| `MarkReady` | accepted AC/spec, owner, dependency and scope readiness | readiness evaluation + phase |
| `DispatchRun` | Ready/current inputs, no active blockers/unknown mutation, budget/WIP | new Run + outbox intent + Developing |
| `SubmitCandidate` | current input, sealed candidate and manifest, complete Run report | Candidate + Review phase |
| `RequestQA` | required Reviews approve exact subject | QA phase + verifier intents |
| `RequestRework` | Review/QA, finding and exact subject | new work revision + Developing |
| `CompleteWorkItem` | full HAI-DONE predicate | CompletionRecord + Done atomically |
| `ReopenWorkItem` | human, reason and new work revision | Draft or Ready; old completion retained |
| `RequestCancellation` | human policy, current mutable work | cancellation condition; no new dispatch |
| `FinalizeCancellation` | no unverified active/unknown side effect | Canceled terminal result |

## Evidence coverage

Coverage is calculated, never represented by fake placeholder Evidence. A required AC is covered only
by Present material whose digest verifies, Passing observation, Accepted disposition, Fresh
applicability, exact CompletionSubject match and allowed verifier class. The API returns a stable
coverage record for every required AC with the matching evidence IDs or a reason code.

Minimum rejection codes include `phase_not_qa`, `active_blocker`, `active_or_unknown_run`,
`candidate_missing`, `candidate_unavailable`, `subject_stale`, `review_missing`, `review_rejected`,
`evidence_missing`, `evidence_nonpassing`, `evidence_stale`, `evidence_unavailable`,
`verifier_not_independent`, `approval_missing`, `approval_expired`, `version_conflict` and
`idempotency_conflict`.

## Test oracles

- `TestWorkItemTransitions_Table`
- `TestBlockers_AreOrthogonalSet`
- `TestRetry_CreatesNewRun`
- `TestCompletionSubject_CanonicalDigest`
- `TestCompleteWorkItem_AllRequiredEvidence`
- `TestCompleteWorkItem_RejectsEveryNonPassingEvidenceState`
- `TestCompleteWorkItem_RejectsSubjectTOCTOU`
- `TestCompleteWorkItem_PreservesHistoryOnReopenAndStale`
