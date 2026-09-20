# Synthetic knowledge ingestion MVP verification

## Environment and source

- Spec: `specs/active/knowledge-ingestion/spec.md`
- Base SHA: `91237ec62112f6a3ee8cdd6c2cfa6e3939854bc1`
- Verification time (UTC): 2026-09-03T04:04:10Z
- Data/provider classification: synthetic local fixtures; no provider

## Acceptance evidence

| Criterion | Status | Command or evidence | Exit code | Notes |
|---|---|---|---:|---|
| FR-1, FR-2, FR-5 intake/privacy/taxonomy | pass | `PYTHONPATH=src python3 -m unittest tests.test_knowledge_store -v` | 0 | 12 tests; bounded no-follow intake, immutable source identity, privacy/rights/taxonomy gates |
| FR-3, FR-4 extraction/cache | pass | `PYTHONPATH=src python3 -m unittest tests.test_extraction -v` | 0 | 7 tests; synthetic PDF/PBM extraction, cache identity/tamper gates |
| FR-5, FR-6 FTS5/proposals | pass | `PYTHONPATH=src python3 -m unittest tests.test_knowledge_index -v` | 0 | 12 tests; FTS integrity, exact provenance and conclusion bindings |
| FR-7 CLI journey | pass | `PYTHONPATH=src python3 -m unittest tests.test_knowledge_e2e -v` | 0 | 5 tests; text/scanned journeys, deterministic rebuild, stage and manifest isolation |
| Full repository gate | pass | `make check` | 0 | Phase 0 policy check plus 121 tests |
| Independent adversarial probe | pass | `PYTHONPATH=src:. python3 /tmp/t017_probe.py` | 0 | stage bypass, cross-manifest citation, and forged provider-policy success were all `False` |
| Source SDD integrity | pass | `sha256sum -c docs/execution/sdd-source.sha256` | 0 | source copy unchanged |

## Final assessment

- Gate: `CODE_COMPLETE_EXTERNAL_PENDING`
- External evidence still required: production PDF/OCR, malware scan, object storage, real corpus rights, and provider proposal boundary
- Risks and open questions: the synthetic extractor must not be represented as arbitrary-document support
