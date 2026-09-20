# Reproducible publication compiler verification

## Environment and source

- Spec: `specs/active/publication-compiler/spec.md`
- Base SHA: `18e4596f30a7c9bb477f443718e1c7b7f7ac1866`
- Verification time (UTC): 2026-09-03T05:10:51Z
- Data/provider classification: tracked synthetic local fixture; no provider

## Acceptance evidence

| Criterion | Status | Command or evidence | Exit code | Notes |
|---|---|---|---:|---|
| FR-1–FR-3 pure compiler | pass | `PYTHONPATH=src python3 -m unittest tests.test_publication -v` | 0 | 7 strict immutable compiler/rendering tests |
| FR-4, FR-5 safe reproducible build | pass | `PYTHONPATH=src python3 -m unittest tests.test_publication_build -v` | 0 | 8 pinned-descriptor, confinement, collision, and atomicity tests |
| FR-6 two-book shared knowledge | pass | `PYTHONPATH=src python3 -m unittest tests.test_publication_e2e -v` | 0 | 2 clean-rebuild and fail-closed shared-source tests |
| Repository regression gate | pass | `make check` | 0 | policy gate and 160 offline tests |
| Source SDD immutability | pass | `sha256sum -c docs/execution/sdd-source.sha256` | 0 | all 11 copied source files match |

## Final assessment

- Gate: `CODE_COMPLETE_EXTERNAL_PENDING`
- External evidence still required: public-release rights review, production
  publication target/signing identity, and optional EPUB/PDF toolchain
- Risks and open questions: generated Markdown/HTML prove local reproducibility only;
  they do not grant publication rights or certify real production experience
