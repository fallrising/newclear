# Proposed truthful WorkItem detail

Status: **Proposal; awaiting owner D1**. T-0339 / BOARD HDTLP. Proposal source `a502addb`.
Nothing here is accepted or implemented; IDX, policy, coverage and rework contracts are unchanged.
Claude review dispositions: [plan evidence](../evidence/work-item-detail-plan-20261102.md).

## Why this is the next bounded slice

Delivered M2 slices fix AC identity, policy, verified coverage, material discovery and the rework loop.
The [M2 reconciliation](work-item-material-index-20261101.md#m2-obligation-reconciliation) leaves one M2 row open:
**detail/coverage authoritative interpretation**. HAI SDD §UX surface 2 requires a WorkItem detail with
ACs, Runs, Candidate, Review, Evidence, approvals and audit history, and M3 cannot show a completion flow without it.

| Finding | Source | Consequence |
| --- | --- | --- |
| `GET work-items/{id}` and `WorkItemDetail` are declared but have no handler or consumer | api/openapi.yaml `WorkItemDetail`; server.go registers no route; no web/Go reference to `WorkItemDetail` | `WorkItemDetail` itself can be corrected in place. Its item schemas `Review`, `Evidence` and `Blocker` are also implemented command request bodies and must not change |
| The declared shape requires fields storage never recorded | [material-index full-detail gaps](work-item-material-index-20261101.md#full-detail-gaps-that-cannot-be-fabricated) (blocker kind/resolver/created_at, review class, evidence observed_at, approval decided_at, completion graph/policy/validity, audit subject kind/id) | Implementing it as declared would mean fabricating values |
| Reviews, Evidence and Approvals have no WorkItem column, but their WorkItem is already stored | Every successful command appends, in the same transaction, an immutable audit entry whose `subject_digest` is the stored row's subject (service.go `execute`; vertical.go fixture review/evidence/approval, human_report.go, CompleteWorkItem). The audit group's `command_id` resolves to an immutable command result that must carry a valid `work_item_id` (result.go). A subject digest also commits to its WorkItem (domain/subject.go) | Attribution is a stored fact for every row, so no migration is needed and listed collections are exact |

Also confirmed and kept: rejected approvals are refused rather than stored, so every stored approval has decision
Approved and `approval_id` equal to the request ID. Blockers store only ID, reason and resolution time, and today
come only from CreateWorkItem: `AddBlocker`/`ResolveBlocker` store methods have no command caller.

Not chosen: M3 completion UI (needs this read first), M4 durable impact (larger; needs its own migration
contract), and M5a checkpoint resume (independent; can follow).

## Concrete contract (DTL-01..04)

### DTL-01 — Endpoint, scope and errors

`GET /api/v1/projects/{project_id}/work-items/{work_item_id}` (the existing OpenAPI path) returns
`work_item_detail/v1`. IDX-01 precedence (canonical path, GET-only with literal `Allow: GET`, session,
masked project/item, no query/body, cancellation/revocation recheck) and IDX-04 classification
(`projection_unavailable`, `storage_corruption`, masked 404) apply unchanged. The read uses one SQLite snapshot and never writes.

### DTL-02 — Truthful closed shape

`WorkItemDetail` is rewritten in place and references new detail-only item schemas (`WorkItemDetailBlocker`,
`…Review`, `…Evidence`, `…Approval`, `…CompletionRecord`, `…AuditEntry`). The existing `Blocker`, `Review`,
`Evidence`, `Approval`, `CompletionRecord` and `AuditEntry` schemas, and every command payload using them, are unchanged.
Every field is stored, joined from stored rows, or projected by an existing accepted rule. Unrecorded fields are omitted, not nulled:

| Collection | Fields | Omitted (never stored) |
| --- | --- | --- |
| summary | Same row the board projection emits in the same snapshot (existing conservative coverage) | — |
| goal, accepted_specification, required_ac_revisions, Runs, Candidates | The material-index v1 DTOs, unchanged (the accepted specification carries graph and policy revision digests) | dependencies: per-edge listing belongs to the Impact surface (M4/M5) |
| blockers | blocker_id, reason, resolved_at (nullable) | kind, required_input, resolver_id, created_at, due_at |
| reviews | review_id, completion_subject_digest, reviewer_id, independent, verdict (stored Approved/Rejected), created_at; `human_report_id` when a human report links it | reviewer_class |
| evidence | evidence_id, subject, ac_id, ac_revision_digest, the stored verdict/applicability/availability vocabularies, verifier class/actor/role, recipe/environment digests, report_artifact_digest (nullable); `human_report_id` when linked | observed_at, review_disposition |
| approvals | approval_id, subject_digest, decision (always Approved), actor_id, expires_at, consumed_at and completion_record_id (nullable, from approval_consumptions) | request_id (identical to approval_id), decided_at |
| completion_records | id, subject, result_work_item_version, completed_by, completed_at, evidence/review/approval IDs | graph/policy digests, effective_satisfied (Done validity needs its own contract) |
| audit | sequence, group_id, command_id, actor_id, operation, subject/before/after digests, occurred_at (group time), and the result's run_id when present | subject_kind, subject_id |

Order: blockers and approvals by ID; reviews by created_at then ID; evidence by ID; completion records by completed_at then ID;
audit by sequence. IDs use binary order. The material-index limits apply per collection: 1024 rows, 4 MiB in total.
Exceeding a limit is `503 projection_unavailable` with reason `work_item_detail_capacity_exceeded`. Nothing is silently truncated.

### DTL-03 — Attribution from stored audit

- **Reviews, Evidence, Approvals:** a row belongs to this WorkItem when an audit entry with the row's subject digest
  belongs to a group whose command result names this WorkItem. A new read-side decoder applies the same canonical
  checks as `DecodeCanonicalResult` and returns the result's operation, `work_item_id` and `run_id`. It takes the operation
  from the stored result, not from the audit entry: runtime entries such as `ClaimDispatch` and `PublishRunObservation`
  are not command operations.
  Because the write path guarantees such an entry exists, a row with no attributing entry, or with entries naming
  different WorkItems, is `503 storage_corruption`. The lists are therefore exact, and no completeness flag is needed.
- **Completion records, human reports:** their own `work_item_id`.
- **Audit:** groups whose command result names this WorkItem, plus `AcceptInitialSpecification` groups whose result's
  `accepted_revision_digest` has an `accepted_work_item_bindings` row for this WorkItem. That command advances every bound
  WorkItem's version but its result carries no `work_item_id`. Runtime groups (Run observations, cancel acknowledgement)
  reuse the dispatch or cancel command ID, whose result names the WorkItem, so they are included. `CreateProject` and
  `ProposeSpecification` change no WorkItem and stay project audit.

### DTL-04 — Boundaries and authorized amendments

Amend OpenAPI (`WorkItemDetail`, the new detail-only item schemas, the GET operation's responses), add
`docs/sdd/work-item-detail.md` as the normative entry and reference it from SDD §UX surface 2.
No migration, schema index, dependency or command change. Attribution scans the project's audit (no audit index
 exists); that cost is accepted for this slice, and an index may be proposed later only from measured latency. Out of scope: UI, pagination, dependency-edge listing,
Done validity and `effective_satisfied` semantics, blocker commands and metadata, Impact, providers, release and deploy.
The board's conservative summary and existing command guards are unchanged.

## Fixed acceptance (DTL-AC-01..06)

| ID | Given / When / Then | Planned test |
| --- | --- | --- |
| DTL-AC-01 | Given the IDX-01 matrix on the new route, When requests vary method/HEAD/query/body/session/project/item, Then status and precedence match IDX-01, with no storage read before authorization | `TestWorkItemDetailHTTP_ScopeAndPrecedence` |
| DTL-AC-02 | Given real SQLite with a blocker, a fixture review, a human review, evidence (one with null report), a consumed approval and a completion, When detail is read, Then the JSON validates against the closed OpenAPI schema and every value equals the stored row; command payload schemas are byte-unchanged | `TestWorkItemDetail_TruthfulShape` + schema fixtures |
| DTL-AC-03 | Given two WorkItems in one project, a rework cycle A→B on one, and a fixture-only subject (review, evidence, approval with no completion, rework or human report), When each detail is read, Then each row appears only under its own WorkItem, both Candidates' rows and the fixture-only rows appear, completion joins are exact, and the audit includes the initial acceptance group for both bound items and the Run's `ClaimDispatch`/`PublishRunObservation` entries under that item only | `TestWorkItemDetail_AttributionAcrossItemsAndRework` |
| DTL-AC-04 | Given an injected review/evidence/approval row with no attributing audit entry, or with entries naming two WorkItems, When detail is read, Then `503 storage_corruption` without leaking either WorkItem | `TestWorkItemDetail_AttributionCorruption` |
| DTL-AC-05 | Given concurrent writers and 1025-row or corrupted fixtures, Then the read is one snapshot, row counts are unchanged afterwards, capacity returns 503 with the exact reason, and corruption returns 503 `storage_corruption` | `TestWorkItemDetail_SnapshotCapacityCorruption` |
| DTL-AC-06 | Pinned backend full/race/vet/build, web regression, Redocly, docs/index checks; Claude plan and code review dispositions; exact-head CI, normal merge, readback, BOARD/desk/handoff | Delivery evidence |

## Decision requested

- **D1:** Approve DTL-01..04 and DTL-AC-01..06: the truthful detail shape with new detail-only item schemas,
  audit-derived attribution where an unattributable row is `storage_corruption`, and the acceptance-audit rule.

An earlier draft also asked for a migration-backed attribution table (D2). Review showed the attribution is already
stored, so that decision is withdrawn; a table could return later only as a measured read-performance index.

## Limits

This proposal changes no behavior. Full M2 closes only after the DTL slice and the existing M2 acceptance rows pass together.
M3 completion UI, SUCCESS AC-02..04 and Done validity remain open.
