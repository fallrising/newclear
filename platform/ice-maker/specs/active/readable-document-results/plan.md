# Deterministic readable document results implementation plan

## Scope and design

Build one five-file vertical slice over the existing completed batch and FTS5
boundaries. A pure renderer validates and reconstructs chunks. The index exposes
one bounded source read. The durable service binds requested sources to one
completed result and serves listing JSON, Markdown, and an escaped `<pre>` view.
No persisted schema, dependency, extraction, or publication boundary changes.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-4–FR-7 | `readable_results.py` | `tests.test_readable_results` | remove pure renderer |
| FR-1, FR-3, FR-8 | `knowledge_index.py`, service methods | focused index/service tests | remove read methods/routes |
| FR-2, NFR-1–NFR-3 | service API/browser view | focused ASGI and adversarial tests | remove routes/UI links |
| Operational use | README, runbook, E2E | production-ingestion E2E | documentation-only revert |

## Risks and dependencies

- Cross-batch disclosure: derive membership from the requested completed result
  before reading the index and test two-batch isolation.
- Untrusted markup: use Markdown indented code and escaped HTML `<pre>` only.
- Resource exhaustion: pre-count chunks/text bytes and cap final encoded bodies.
- Reconstruction overclaim: label OCR order as heuristic and retain provenance.

## Migration and rollout

None. Existing state remains compatible and read-only. Remove the new routes and
renderer to roll back; do not delete the original or indexed private data.

## Review gate

The orchestrator reviews every diff, reruns focused and repository-wide tests,
then performs a private ten-document smoke whose aggregate evidence stays
outside Git. No commit, push, PR, merge, publication, or deployment is included.
