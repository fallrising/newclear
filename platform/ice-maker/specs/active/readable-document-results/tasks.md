# Deterministic readable document results executable tasks

- [x] T-039 Implement the readable-result vertical slice
  - Depends on: T-038
  - Allowed paths: `src/ice_maker/readable_results.py`, `src/ice_maker/knowledge_index.py`, `src/ice_maker/document_service.py`, `tests/test_readable_results.py`, `tests/test_document_service.py`
  - Acceptance: deterministic native/OCR reconstruction, completed-batch listing, source-isolated Markdown/browser routes, bounds, provenance, and injection failures pass focused tests.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_readable_results tests.test_document_service tests.test_knowledge_index -v`

- [x] T-040 Document and exercise the integrated user journey
  - Depends on: T-039
  - Allowed paths: `README.md`, `docs/runbooks/production-document-ingestion.md`, `tests/test_production_ingestion_e2e.py`, `specs/active/readable-document-results/verification.md`
  - Acceptance: supported routes and limitations are documented, and one completed generated batch lists and renders a source without persisting private text.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_production_ingestion_e2e -v`

- [x] T-041 Run the private pilot and final gates
  - Depends on: T-040
  - Allowed paths: none; orchestrator-owned runtime evidence only
  - Acceptance: all ten prior pilot sources list and render within bounds; aggregate results are recorded without placing extracted text in Git.
  - Suggested role: codex-strong
  - Max attempts: 1
  - Required commands: SDD validation, focused tests, `make check`, and local service smoke

## Task-to-requirement mapping

| Task | Requirements | Evidence |
|---|---|---|
| T-039 | FR-1–FR-8, NFR-1–NFR-3 | renderer/index/service tests |
| T-040 | user journey and operations | E2E plus documentation review |
| T-041 | final/private runtime gate | aggregate local evidence |
