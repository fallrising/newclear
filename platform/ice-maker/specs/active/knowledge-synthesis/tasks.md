# Provenance-bound knowledge synthesis executable tasks

- [x] T-018 Add deterministic note retrieval and integrity reports
  - Depends on: Phase 4
  - Allowed paths: `src/ice_maker/knowledge_graph.py`, `tests/test_knowledge_graph.py`, `.team/reports/T-018.md`
  - Acceptance: bounded immutable notes compare deterministically and emit exact duplicate, contradiction, and orphan evidence.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_knowledge_graph -v`

- [x] T-019 Add digest-bound promotion and human approval gates
  - Depends on: Phase 4
  - Allowed paths: `src/ice_maker/promotion.py`, `tests/test_promotion.py`, `.team/reports/T-019.md`
  - Acceptance: only ordered promotions with exact citations, independent critic acceptance, and distinct digest-bound human approval succeed.
  - Suggested role: security-sensitive builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_promotion -v`

- [x] T-020 Compose synthetic horizontal comparison and independent critique
  - Depends on: T-018, T-019
  - Allowed paths: `src/ice_maker/synthesis.py`, `tests/test_synthesis_e2e.py`, `docs/runbooks/knowledge-synthesis.md`, `.team/reports/T-020.md`
  - Acceptance: two marked-synthetic experiences form one cited pattern candidate; unsupported inference remains a hypothesis and all promotion gates are observable.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_synthesis_e2e -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-018 | FR-1, FR-2 | retrieval and stable integrity-report tests |
| T-019 | FR-3, FR-4, FR-5 | promotion state/actor/digest/citation tests |
| T-020 | FR-6 | synthetic two-experience E2E and runbook |
