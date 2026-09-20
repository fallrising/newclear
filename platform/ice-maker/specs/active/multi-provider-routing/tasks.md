# Multi-provider routing executable tasks

- [x] T-011 Add OpenCode builder and read-only review adapters
  - Depends on: Phase 2
  - Allowed paths: `src/ice_maker/adapters.py`, `tests/test_adapters.py`, `.team/reports/T-011.md`
  - Acceptance: fake Codex and OpenCode CLIs execute one fixture; Claude/Grok review argv is read-only, non-interactive, bounded, and safe.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_adapters -v`

- [x] T-012 Add deterministic routing policy and usage ledger
  - Depends on: Phase 2
  - Allowed paths: `src/ice_maker/routing.py`, `config/provider-routing.json`, `tests/test_routing.py`, `.team/reports/T-012.md`
  - Acceptance: role/health/rate-limit/data/budget selection, explicit equal-tier fallback, repeated-signature stop, and immutable usage totals are deterministic and fail closed.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_routing -v`

- [x] T-013 Compose sequential builder, gate, and independent reviewer
  - Depends on: T-011, T-012
  - Allowed paths: `src/ice_maker/pipeline.py`, `tests/test_pipeline.py`, `docs/verification/phase-3.md`, `docs/runbooks/providers.md`, `.team/reports/T-013.md`
  - Acceptance: a synthetic success records builder/gate/different-provider review evidence; failure, same-provider review, write-capable review, and exhausted budget are non-publishable.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_pipeline -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-011 | FR-1, FR-2 | fake-CLI adapter tests |
| T-012 | FR-3, FR-4, FR-5 | deterministic routing and ledger tests |
| T-013 | FR-6 | sequential pipeline and repository gate |
