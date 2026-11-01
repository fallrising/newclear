# WorkItem material-index API

Status: Accepted by owner, 2026-11-01. T-0339 / HMDTL. This refines HAI-API-001/004/005
and supports HAI-CONNECT-007 without granting completion authority.

The owner approved D1 of the [Claude-reviewed contract](../plans/work-item-material-index-20261101.md).
Its IDX-01..05 clauses and fixed IDX-AC-01..06 are incorporated normatively and remain the
implementation acceptance criteria. The earlier proposal evidence is a historical NotRun checkpoint.

## Scope

GET `/api/v1/projects/{project_id}/work-items/{work_item_id}/material-index` discovers persisted
WorkItem metadata, exact legacy or accepted AC requirements, scoped Runs and Candidates.
The closed `work_item_material_index/v1` response includes its snapshot cursor and restore generation.
It contains no inferred coverage, current/default Candidate, artifact bytes or completion authority.
The existing full WorkItemDetail endpoint/schema remains outstanding and unchanged.

## Invariants

- Enforce IDX-01 canonical path, explicit GET-only method, session, masked project/item,
  query/body and storage precedence; recheck cancellation/revocation before success.
- Read all rows and cursor in one deferred SQLite WAL snapshot. Reuse guarded WorkItem/Done
  rehydration after bounded blocker preflight; never invoke a writer transaction or artifact IO.
- Preserve byte-exact legacy AC and Candidate IDs. Accepted and legacy AC schemas differ.
  Both Initial and recorded Impact relations are observable; this does not implement Impact commands.
- Validate stored scope, head/binding/set relations and bounded scalar data. Return all scoped rows
  in deterministic order within1024-per-collection/4MiB limits; never silently truncate.
- Capacity is503 projection_unavailable with exactly reason=material_index_capacity_exceeded;
  malformed data is503 storage_corruption; missing scope is masked404. No private causes leak.
- Readability does not establish policy/artifact availability, freshness, eligibility or Done.
  Existing output/preparation/coverage and explicit commands keep their exact guards.

## Implementation seams and verification

An optional application `MaterialIndexReader` supplies typed immutable row DTOs. SQLite owns
snapshot consistency and bounded row loading; the existing persisted HTTP projection adapter
encodes and validates the closed wire contract. No command-service or database migration is needed.
Unavailable optional capability fails503 rather than returning empty successful material.

Root owns HTTP/OpenAPI and real SQLite/Fake discovery-to-completion integration. One isolated
worker owns only the new SQLite implementation/tests; root owns the application DTO/reader. Named HTTP404
Red precedes production implementation. Fixed IDX-AC-01..06 require source-bound normal/race,
vet/build, web, OpenAPI/doc gates, Claude code review and normal Git delivery. Current observed results are mapped in [implementation evidence](../evidence/work-item-material-index-20261101.md).
Full M2, full historical detail and completion UI remain incomplete.
