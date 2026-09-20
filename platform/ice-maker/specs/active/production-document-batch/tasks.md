# Production document batch ingestion executable tasks

Each task is a bounded vertical slice. Task identifiers continue the repository
ledger after T-026.

- [x] T-027 Add a reproducible host/runtime capability doctor
  - Depends on: none
  - Allowed paths: `scripts/document-ingestion-doctor.sh`, `tests/test_document_ingestion_doctor.py`, `docs/runbooks/production-document-ingestion.md`
  - Acceptance: fixture-driven tests prove stable capability classifications and the real host report truthfully identifies capacity, Docker/security support, GPU absence, and missing parser/OCR tools without modifying the host.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_document_ingestion_doctor -v`

- [x] T-028 Add batch manifest, configuration, and immutable result contracts
  - Depends on: T-027
  - Allowed paths: `config/document-ingestion.json`, `src/ice_maker/document_batch.py`, `tests/test_document_batch.py`
  - Acceptance: strict 1–100 item manifests, no-follow input-root confinement, code-owned ceilings, canonical ordering, immutable item states, and atomic checkpoints pass focused adversarial tests.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_document_batch -v`

- [x] T-029 Add real image decoding, tiling, and OCR TSV adapter
  - Depends on: T-028
  - Allowed paths: `pyproject.toml`, `src/ice_maker/production_extraction.py`, `tests/test_production_extraction.py`
  - Acceptance: signature-bound PNG/JPEG/WebP inputs are bounded, tiled, OCRed through a no-shell constrained adapter, overlap-deduplicated, and mapped to original coordinates; malformed, unavailable, timed-out, or unsafe inputs fail closed.
  - Suggested role: codex-terra
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_production_extraction -v`

- [x] T-030 Add native, scanned, and mixed PDF page extraction
  - Depends on: T-029
  - Allowed paths: `src/ice_maker/production_extraction.py`, `tests/test_production_extraction.py`
  - Acceptance: each bounded PDF page independently selects validated native text or raster OCR with exact page provenance; encrypted, malformed, oversized, mismatched, and failed-tool cases publish no success.
  - Suggested role: codex-terra
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_production_extraction -v`

- [x] T-031 Wire resumable `knowledge batch`, production indexing, and bounded reporting
  - Depends on: T-028, T-029, T-030
  - Allowed paths: `src/ice_maker/document_batch.py`, `src/ice_maker/knowledge_cli.py`, `src/ice_maker/knowledge_index.py`, `tests/test_document_batch.py`, `tests/test_knowledge_index.py`
  - Acceptance: canonical batches isolate failures, atomically checkpoint successes, resume without repeated OCR, accept bounded normalized Unicode plus production OCR methods/long-image coordinates in FTS5, emit exact safe status counts, and return non-zero on rejected/failed items without changing legacy synthetic behavior.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_document_batch -v`

- [x] T-032 Add loopback batch-upload service and restart recovery
  - Depends on: T-031
  - Allowed paths: `pyproject.toml`, `src/ice_maker/document_service.py`, `tests/test_document_service.py`
  - Acceptance: streamed 1–100 file upload returns 202 and a stable batch ID; health/status, limits, atomic manifest publication, loopback enforcement, safe filenames, worker bounds, and durable restart recovery pass API tests.
  - Suggested role: codex-terra
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_document_service -v`

- [x] T-033 Package and constrain the local service runtime
  - Depends on: T-032
  - Allowed paths: `docker/document-service.Dockerfile`, `scripts/build-document-service.sh`, `scripts/run-document-service.sh`, `tests/test_document_service.py`
  - Acceptance: a pinned image installs the approved parser/OCR/language stack; build/run scripts are idempotent and the run command binds loopback with dropped capabilities, no-new-privileges, read-only root, CPU/memory/PID bounds, tmpfs, and one writable data volume.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_document_service -v`

- [x] T-034 Prove the complete 100-document journey and publish the runbook
  - Depends on: T-033
  - Allowed paths: `tests/test_production_ingestion_e2e.py`, `docs/runbooks/production-document-ingestion.md`, `specs/active/production-document-batch/**`, `README.md`
  - Acceptance: a generated 70-PDF/30-image batch proves deterministic resume, duplicate reuse, mixed success/failure reporting, citations, no provider capability, service upload/status, and compatibility; exact operator and benchmark commands plus external pilot gates are documented.
  - Suggested role: codex-cheap
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_production_ingestion_e2e -v && make check`

- [x] T-035 Export approved results as a native local study bundle
  - Depends on: T-031
  - Allowed paths: `config/study-publication.json`, `src/ice_maker/study_export.py`, `src/ice_maker/study_cli.py`, `tests/test_study_export.py`
  - Acceptance: a digest-bound export renders the complete `doc_analysis_study` study contract and registry patch with stable source IDs/evidence levels/QA/publication decisions; raw bytes, absolute paths, prohibited/unapproved content, mutable inputs, forged digests, and partial output fail closed.
  - Suggested role: codex-terra
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_study_export -v`

- [x] T-036 Add isolated local publication into `doc_analysis_study`
  - Depends on: T-035
  - Allowed paths: `src/ice_maker/study_publisher.py`, `src/ice_maker/study_cli.py`, `tests/test_study_publisher.py`
  - Acceptance: a validated bundle is applied only to a new study tree and deterministic registry row in a dedicated base-pinned checkout, target-native validation passes, exact diff evidence is returned, re-run is idempotent, and dirty/stale/wrong-repository/out-of-scope changes fail before publication.
  - Suggested role: codex-terra
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_study_publisher -v`

- [x] T-037 Add explicit GitHub draft-PR publication
  - Depends on: T-036
  - Allowed paths: `config/study-publication.json`, `scripts/publish-study.sh`, `src/ice_maker/study_publisher.py`, `tests/test_study_publisher.py`, `docs/runbooks/study-publication.md`, `README.md`
  - Acceptance: allowlisted host-side publication creates one unique branch/commit/push/draft-PR request with validated exact paths and retained evidence; fake-remote E2E proves failures never mutate `main`, expose credentials, delete the local bundle, or grant Git capability to the service.
  - Suggested role: codex-terra
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_study_publisher -v && make check`

- [x] T-042 Serialize concurrent access to the shared document index
  - Depends on: T-031, T-032
  - Allowed paths: `specs/active/production-document-batch/spec.md`, `specs/active/production-document-batch/tasks.md`, `specs/active/production-document-batch/verification.md`, `src/ice_maker/knowledge_index.py`, `tests/test_knowledge_index.py`
  - Acceptance: concurrent service workers serialize before opening the same SQLite inode, both valid sources commit without transient item failure, and lock contention fails within the code-owned bound.
  - Suggested role: codex-strong
  - Max attempts: 1
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_knowledge_index tests.test_document_service -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-027 | FR-11, NFR-6 | fixture doctor tests and real host report |
| T-028 | FR-1, FR-2, FR-7, NFR-2, NFR-3 | contract/config/path/checkpoint tests |
| T-029 | FR-4, FR-5, FR-6, NFR-1, NFR-2 | image/OCR adapter tests |
| T-030 | FR-3, FR-5, FR-6 | native/scanned/mixed PDF tests |
| T-031 | FR-7 through FR-10 | CLI/resume/report tests |
| T-032 | FR-12, FR-13, NFR-7 | service upload/recovery tests |
| T-033 | FR-14, NFR-4, NFR-6 | container policy and smoke evidence |
| T-034 | G-1 through G-6, NFR-5 | 100-item E2E, full gate, runbook |
| T-035 | FR-15 through FR-17, NFR-9 | export/render/approval tests |
| T-036 | FR-18, NFR-8, NFR-9 | isolated target and native-validator tests |
| T-037 | FR-19, FR-20, NFR-8, NFR-9 | fake-remote publication E2E and runbook |
| T-042 | FR-10, FR-13, NFR-3 | deterministic concurrent-open and bounded lock tests plus 50-run service reproducer |
