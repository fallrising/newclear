# Synthetic knowledge ingestion MVP executable tasks

- [x] T-014 Add secure content-addressed intake and taxonomy contracts
  - Depends on: Phase 3
  - Allowed paths: `src/ice_maker/knowledge_store.py`, `tests/test_knowledge_store.py`, `knowledge/90-meta/taxonomy.yaml`, `.team/reports/T-014.md`
  - Acceptance: bounded regular PDF/PBM sources deduplicate by hash; sensitive, rights, data-class, manifest, and taxonomy decisions fail closed.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_knowledge_store -v`

- [x] T-015 Add deterministic synthetic PDF and bitmap OCR extraction
  - Depends on: Phase 3
  - Allowed paths: `src/ice_maker/extraction.py`, `tests/test_extraction.py`, `.team/reports/T-015.md`
  - Acceptance: byte-valid text/scanned PDFs and a PBM image yield bounded page/region chunks; hash/version cache prevents repeat OCR.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_extraction -v`

- [x] T-016 Add provenance-checked FTS5 indexing and proposals
  - Depends on: T-014, T-015
  - Allowed paths: `src/ice_maker/knowledge_index.py`, `tests/test_knowledge_index.py`, `.team/reports/T-016.md`
  - Acceptance: immutable chunks index and retrieve deterministically with BM25; every unpromoted proposal cites valid source/page/region/method/chunk provenance.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_knowledge_index -v`

- [x] T-017 Wire the four-stage knowledge CLI and two-PDF journey
  - Depends on: T-016
  - Allowed paths: `src/ice_maker/knowledge_cli.py`, `pyproject.toml`, `tests/test_knowledge_e2e.py`, `docs/runbooks/knowledge-ingestion.md`, `.team/reports/T-017.md`
  - Acceptance: `knowledge ingest/extract/index/propose` completes both PDFs from fresh local state; rerun proves dedupe/no repeat OCR and unsafe input stops before proposal.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_knowledge_e2e -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-014 | FR-1, FR-2, FR-5 | intake/privacy/taxonomy tests |
| T-015 | FR-3, FR-4 | text/scanned/image extraction tests |
| T-016 | FR-5, FR-6 | FTS5/provenance/proposal tests |
| T-017 | FR-7 | two-PDF CLI E2E evidence |
