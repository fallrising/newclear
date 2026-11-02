# Truthful WorkItem detail

Status: Accepted by owner, 2026-11-02. T-0339 / HDTL. This implements HAI SDD §UX surface 2 (WorkItem detail)
and closes the M2 "detail/coverage authoritative interpretation" row for reads. It grants no completion authority.

The owner approved D1 of the [Claude-reviewed proposal](../plans/work-item-detail-20261102.md). Its DTL-01..04
clauses and fixed DTL-AC-01..06 are normative here and remain the implementation acceptance criteria.

## Scope

GET `/api/v1/projects/{project_id}/work-items/{work_item_id}` returns the closed `work_item_detail/v1`:
- `summary`: the board row for this WorkItem, computed from the same snapshot with the board's conservative coverage.
- `material`: the `work_item_material_index/v1` object, unchanged. Its cursor and restore generation identify the snapshot.
- `blockers`, `reviews`, `evidence`, `approvals`, `completion_records`, `audit`: stored history (DTL-02).

Fields storage never recorded are omitted. A `null` means a stored NULL: an unresolved blocker, evidence with no report,
an unconsumed approval, an audit entry with no before/after digest, or a result naming no Run.
The earlier `WorkItemDetail` shape and its detail-only `DependencyRef`, `Approval`, `CompletionRecord` and `AuditEntry`
schemas were never implemented and are replaced. Command payload schemas (`Blocker`, `Review`, `Evidence`) are unchanged.

## Attribution

- Review, Evidence and Approval rows belong to the WorkItem named by the command result of the audit group that
  recorded their subject digest. Every write path appends that audit entry in the same transaction.
- A row with no attributing audit entry, or whose subject is attributed to two WorkItems, is `503 storage_corruption`.
  Such a row anywhere in the project fails every detail read in that project, because the lists would otherwise be inexact.
- Completion records and human reports use their own `work_item_id`.
- Audit lists the groups whose command result names this WorkItem, plus `AcceptInitialSpecification` groups whose
  accepted revision binds it. The command result is decoded with the same canonical checks as `DecodeCanonicalResult`,
  using the operation stored in the result; runtime audit operations such as `ClaimDispatch` are not command operations.
- Attribution scans the project's audit. No index is added; one may be proposed later only from measured latency.

## Invariants

- IDX-01 precedence and IDX-04 classification apply unchanged. Capacity is `503 projection_unavailable` with exactly
  `reason=work_item_detail_capacity_exceeded`; material-index capacity inside the detail read maps to the same reason.
- Every row, the cursor and the summary come from one deferred SQLite snapshot. The read never writes or reads artifacts.
- Per collection at most 1024 rows; encoded response at most 4 MiB. Nothing is silently truncated.
- Readability establishes no coverage, eligibility, freshness or Done validity.

## Implementation seams and verification

An optional application `WorkItemDetailReader` returns typed rows. SQLite owns the snapshot, attribution and bounded
loading; the persisted HTTP projection adapter encodes and validates the closed wire. `command.DecodeResultOwner` is the
read-side result decoder. No migration, dependency or command change. Current results: [implementation evidence](../evidence/work-item-detail-20261102.md).
M3 completion UI, Done validity and SUCCESS AC-02..04 remain open.
