# Proposed truthful WorkItem detail and subject attribution

Status: **Proposal; awaiting owner D1/D2**. T-0339 / BOARD HDTLP. Proposal source `a502addb`.
Nothing here is accepted or implemented; IDX, policy, coverage and rework contracts are unchanged.

## Why this is the next bounded slice

Delivered M2 slices fix AC identity, policy, verified coverage, material discovery and the rework loop.
The [M2 reconciliation](work-item-material-index-20261101.md#m2-obligation-reconciliation) leaves one M2 row open:
**detail/coverage authoritative interpretation**. HAI SDD §UX surface 2 requires a WorkItem detail with
ACs, Runs, Candidate, Review, Evidence, approvals and audit history, and M3 cannot show a completion flow without it.

| Finding | Source | Consequence |
| --- | --- | --- |
| `GET work-items/{id}` and `WorkItemDetail` are declared but have no handler or consumer | api/openapi.yaml `WorkItemDetail`; server.go registers no route; no web/Go reference | The schema can be corrected in place without breaking a client |
| The declared shape requires fields storage never recorded | [material-index full-detail gaps](work-item-material-index-20261101.md#full-detail-gaps-that-cannot-be-fabricated) (blocker kind/resolver/created_at, review class, evidence observed_at, approval decided_at, completion graph/policy/validity, audit subject kind/id) | Implementing it as declared would mean fabricating values |
| Reviews, Evidence and Approvals are stored per project and subject digest, without a WorkItem column | 0001 `reviews`/`evidence`/`approvals`. Only `completion_records`, `human_reports` and `ReworkRequested` results record which WorkItem a subject belongs to | The fixture Review/Evidence and Approval on a subject that never reached completion, rework or a human report cannot be tied to its WorkItem; listing only the linkable ones as "history" would hide the rest |
| A subject digest commits to its WorkItem | domain/subject.go `CompletionSubjectConfig` includes ProjectID and WorkItemID | A recorded subject→WorkItem attribution is a stored fact. Recomputing old subjects would be guessing, because historical WorkItem versions and policies are not stored |

Already true, and kept as is: rejected approvals are refused rather than stored (vertical.go ApproveSubject), so every
stored approval has decision Approved and `approval_id` equal to the request ID. Blockers store only ID, reason and resolution time.

Not chosen: M3 completion UI (needs this read first), M4 durable impact (larger; needs its own migration
contract), and M5a checkpoint resume (independent; can follow).

## Concrete contract (DTL-01..05)

### DTL-01 — Endpoint, scope and errors

`GET /api/v1/projects/{project_id}/work-items/{work_item_id}` (the existing OpenAPI path) returns
`work_item_detail/v1`. IDX-01 precedence (canonical path, GET-only with literal `Allow: GET`, session,
masked project/item, no query/body, cancellation/revocation recheck) and IDX-04 classification
(`projection_unavailable`, `storage_corruption`, masked 404) apply unchanged. The response is read-only and never writes.

### DTL-02 — Truthful closed shape

The never-implemented `WorkItemDetail` schema is rewritten in place. Every field is either stored, joined from stored rows,
or deterministically projected by an existing accepted rule. Unrecorded fields are removed, not nulled:

| Collection | Fields | Removed (never stored) |
| --- | --- | --- |
| summary | Same row the board projection emits in the same snapshot (existing conservative coverage) | — |
| goal, accepted_specification, required_ac_revisions, Runs, Candidates | The material-index v1 DTOs, unchanged (the accepted specification carries graph and policy revision digests) | dependencies: per-edge listing belongs to the Impact surface (M4/M5) |
| blockers | blocker_id, reason, resolved_at (nullable) | kind, required_input, resolver_id, created_at, due_at |
| reviews | review_id, completion_subject_digest, reviewer_id, independent, verdict (stored Approved/Rejected), created_at; `human_report_id` when a human report links it | reviewer_class |
| evidence | evidence_id, subject, ac_id, ac_revision_digest, the stored verdict/applicability/availability vocabularies, verifier class/actor/role, recipe/environment digests, report_artifact_digest (nullable); `human_report_id` when linked | observed_at, review_disposition |
| approvals | approval_id, subject_digest, decision (always Approved), actor_id, expires_at, consumed_at and completion_record_id (nullable, from approval_consumptions) | request_id (identical to approval_id), decided_at |
| completion_records | id, subject, result_work_item_version, completed_by, completed_at, evidence/review/approval IDs | graph/policy digests, effective_satisfied (Done validity needs its own contract) |
| audit | sequence, group_id, command_id, actor_id, operation, subject/before/after digests, occurred_at (group time) | subject_kind, subject_id |

Order: blockers and approvals by ID; reviews by created_at then ID; evidence by ID; completion records by completed_at then ID;
audit by sequence. IDs use binary order. The material-index limits apply per collection: 1024 rows, 4 MiB in total.
Exceeding a limit is `503 projection_unavailable` with reason `work_item_detail_capacity_exceeded`. Nothing is silently truncated.

### DTL-03 — Attribution and completeness

Reviews, evidence and approvals belong to the WorkItem when their subject digest is recorded as attributed to it (DTL-04).
Each of the three collections carries `attribution: complete | partial`:
- `complete` means every row of that kind in the project has an attributed subject, so the listed rows are exactly this WorkItem's.
- `partial` means at least one project row of that kind is unattributed. The response does not reveal which rows or how many.

Completion records and human reports carry their own `work_item_id`. Audit covers the commands addressed to this WorkItem:
groups whose immutable command result names it. Commands addressed to the project (create project, accept specification)
are project audit by definition. Both collections are complete within those definitions and carry no flag.

### DTL-04 — Subject attribution provenance (decision D2)

**D2-a (recommended):** ordered migration `0007` adds a STRICT, immutable `work_item_subject_attributions`
table: project_id, subject_digest (primary key per project), work_item_id and recorded_at_ns.
- Triggers forbid update and delete. Re-recording the same pair is a no-op, and a conflicting WorkItem aborts the transaction.
- Every path that stores a Review, Evidence, Approval, CompletionRecord or human report records the attribution in the same
  transaction, using the WorkItem it already resolved. The migration backfills only from `completion_records` and `human_reports`.
- After the migration, normal operation produces `complete` collections. Older unattributed rows keep a project `partial`
  until that history ages out or is restored without them. Pre-release data is not repaired by guessing.

**D2-b:** no migration. Attribution is computed at read time from `completion_records`, `human_reports` and
`ReworkRequested` results. Fixture Review/Evidence and Approvals on subjects that never reached completion, rework or a
human report stay unattributed, so affected projects stay `partial` permanently.

### DTL-05 — Boundaries and authorized amendments

Amend OpenAPI (`WorkItemDetail` and its sub-schemas, the GET operation's responses), add `docs/sdd/work-item-detail.md`
as the normative entry and reference it from SDD §UX surface 2. Under D2-a, also update the ordered-migrations registry.
Out of scope: UI, pagination, dependency-edge listing, Done validity and `effective_satisfied` semantics, richer blocker metadata, Impact,
providers, new dependencies, release and deploy. The board's conservative summary and existing command guards are unchanged.

## Fixed acceptance (DTL-AC-01..06)

| ID | Given / When / Then | Planned test |
| --- | --- | --- |
| DTL-AC-01 | Given the IDX-01 matrix on the new route, When requests vary method/HEAD/query/body/session/project/item, Then status and precedence match IDX-01, with no storage read before authorization | `TestWorkItemDetailHTTP_ScopeAndPrecedence` |
| DTL-AC-02 | Given real SQLite with a blocker, a fixture review, a human review and evidence (one with null report), a consumed approval and a completion, When detail is read, Then the JSON validates against the closed OpenAPI schema and every value equals the stored row | `TestWorkItemDetail_TruthfulShape` + schema fixtures |
| DTL-AC-03 | Given two WorkItems in one project and an A→rework→B cycle on one, When each detail is read, Then no row from the other WorkItem appears, both Candidates' reviews and evidence appear, completion joins are exact, and all three flags are `complete` | `TestWorkItemDetail_AttributionAcrossItemsAndRework` |
| DTL-AC-04 | Given an injected unattributed review subject, Then only `reviews` turns `partial`, in every WorkItem of that project. (D2-a) Given a 0006 store with fixtures, Then 0007 backfills exactly, the triggers reject update, delete and a conflicting pair, and removing any one writer makes DTL-AC-03 fail (mutation) | `TestWorkItemDetail_PartialAttribution`, `TestMigration0007_*` |
| DTL-AC-05 | Given concurrent writers and 1025-row or corrupted fixtures, Then the read is one snapshot, row counts are unchanged afterwards, capacity returns 503 with the exact reason, and corruption returns 503 `storage_corruption` | `TestWorkItemDetail_SnapshotCapacityCorruption` |
| DTL-AC-06 | Pinned backend full/race/vet/build, web regression, Redocly, docs/index checks; Claude plan and code review dispositions; exact-head CI, normal merge, readback, BOARD/desk/handoff | Delivery evidence |

## Decisions requested

- **D1:** Approve DTL-01..05 and DTL-AC-01..06, including rewriting the never-implemented `WorkItemDetail` schema to the truthful shape.
- **D2:** Choose provenance: **D2-a** (recommended: migration 0007 forward attribution plus relational backfill) or
  **D2-b** (no migration; read-time attribution only, with permanent `partial` where history cannot be linked).

## Limits

This proposal changes no behavior. Full M2 closes only after the DTL slice and the existing M2 acceptance rows pass together.
M3 completion UI, SUCCESS AC-02..04 and Done validity remain open.
