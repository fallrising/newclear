# Reproducible publication compiler executable tasks

- [x] T-021 Add the pure publication compiler
  - Depends on: Phase 5
  - Allowed paths: `src/ice_maker/publication.py`, `tests/test_publication.py`, `.team/reports/T-021.md`
  - Acceptance: strict immutable manifests and knowledge records assemble ordered chapters, resolved cross-references, one exact bibliography, and byte-stable Markdown/HTML carrying the source commit SHA.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_publication -v`

- [x] T-022 Add the confined all-or-nothing build boundary
  - Depends on: T-021
  - Allowed paths: `src/ice_maker/publication_build.py`, `src/ice_maker/publication_cli.py`, `tests/test_publication_build.py`, `.team/reports/T-022.md`
  - Acceptance: no-follow source loading and a confined atomic pair publish reject traversal, symlinks, missing/tampered inputs, collisions, and injected write failures without partial output.
  - Suggested role: security-sensitive builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_publication_build -v`

- [x] T-023 Prove two-book shared-knowledge rebuild
  - Depends on: T-021, T-022
  - Allowed paths: `books/*.json`, `knowledge/50-patterns/*.json`, `tests/test_publication_e2e.py`, `docs/runbooks/publication.md`, `.team/reports/T-023.md`
  - Acceptance: after deleting ignored output, two tracked manifests reuse one marked-synthetic pattern and rebuild byte-identical Markdown/HTML with exact citations and source commit SHA.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_publication_e2e -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-021 | FR-1, FR-2, FR-3 | manifest, assembly, reference, bibliography, renderer tests |
| T-022 | FR-4, FR-5 | confined loader and atomic-pair failure tests |
| T-023 | FR-6 | clean two-book rebuild E2E and runbook |
