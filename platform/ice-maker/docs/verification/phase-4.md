# Phase 4 Verification

- Date: 2026-09-03 (Europe/Berlin)
- Status: `CODE_COMPLETE_EXTERNAL_PENDING`
- Specification: `SDD-0004`, FR-1 through FR-7

## Deterministic local evidence

- `PYTHONPATH=src python3 -m unittest tests.test_knowledge_e2e -v` — passed,
  five subprocess journeys and failure-path tests.
- `make check` — passed; Phase 0 repository policy plus 121 offline tests.
- `PYTHONPATH=src:. python3 /tmp/t017_probe.py` — passed; indexing without
  extraction, cross-manifest citation, and forged-policy proposal all failed.
- `python3 -m py_compile src/ice_maker/knowledge_cli.py` and
  `git diff --check` — passed.
- `sha256sum -c docs/execution/sdd-source.sha256` — passed; all 11 source SDD
  files match their bootstrap hashes.

The tests construct byte-valid synthetic text and bitmap PDFs at runtime. The
four explicit stages publish canonical, digest-bound evidence below ignored
local state. Indexing consumes the exact extraction record without fallback;
per-index databases and citation allowlists isolate each manifest. Downstream
reads reject noncanonical, oversized, forged, mismatched, and symlinked state.

## External evidence pending

| Gate | Status |
|---|---|
| General-purpose production PDF parser | external-pending |
| Production OCR engine, languages, and measured accuracy | external-pending |
| Malware scanning service | external-pending |
| Production object storage | external-pending |
| Human rights approval for a real corpus | external-pending |
| Real provider proposal boundary | external-pending |

The dependency-free extractor is a synthetic control fixture, not evidence of
arbitrary-document or production OCR support. No provider, network, credential,
real corpus, merge, deploy, or direct `main` mutation is claimed.
