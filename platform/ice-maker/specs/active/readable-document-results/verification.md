# Deterministic readable document results verification

## Environment and source

- Spec: `specs/active/readable-document-results/spec.md`
- Base SHA: `91d60a5e8b32926632f687b3601506192afee896`
- Verification time (UTC): `2026-09-04T04:01:38Z`
- Data/provider classification: generated fixtures plus the retained local
  `unconfirmed`/`restricted` ten-document pilot; no provider

## Acceptance evidence

| Criterion | Status | Command or evidence | Exit code | Notes |
|---|---|---|---:|---|
| Native/OCR reconstruction and escaping | pass | T-039 focused suite | 0 | Native offsets, OCR order, compact provenance, confidence markers, inert Markdown, and escaped HTML pass |
| Completed-batch/source isolation and bounds | pass | T-039 service/index tests | 0 | Exact processed membership, progress binding, corrupt state, and stable 404/409/413 handling pass |
| Real loopback HTTP routes | pass | pinned container HTTP suite | 0 | Listing, Markdown, browser preview, content headers, escaping, and error responses pass without host environment skips |
| Integrated generated 70-PDF/30-image journey | pass | T-040 E2E | 0 | 100 inputs produce 97 processed identities, 1 duplicate, 1 rejected, and 1 failed; listing and native/OCR replay are byte-stable |
| Ten-document private smoke | pass | T-043 fresh service rerun | 0 | 10/10 documents, 54 pages, and 16,168 chunks reconstruct; maximum Markdown is 112,254 bytes and maximum HTML is 113,420 bytes |
| Repository quality gate | pass | `make check` | 0 | 303 tests pass; 5 environment-only tests explicitly skip on the host |

## Checks run

| Command | Exit code | Result |
|---|---:|---|
| `PYTHONPATH=src python3 -m ice_maker validate readable-document-results` | 0 | living SDD is valid |
| `PYTHONPATH=src python3 -m unittest tests.test_readable_results tests.test_document_service tests.test_knowledge_index -v` | 0 | 49 focused tests pass; 5 host-environment skips are covered in the pinned container |
| `PYTHONPATH=src python3 -m unittest tests.test_production_ingestion_e2e tests.test_readable_results -v` | 0 | all 10 generated integration and renderer tests pass |
| pinned network-disabled/read-only container: HTTP, readable-result, and shared-index-lock tests | 0 | all 13 tests pass with no skips |
| retained private-pilot read-only reconstruction probe | 0 | 10 documents, 16,168 chunks, both `ocr` and `pdf-text`; every Markdown/HTML result is deterministic and within 256 KiB |
| fresh isolated loopback upload and readable-result smoke | 0 | 10/10 processed in about 546 seconds; 2,458-byte safe listing; 10 deterministic Markdown/HTML results; 5,405 low-confidence review markers; safe unknown-source 404 |
| identical completed-batch resubmission | 0 | same batch identity returned in 0.304 seconds without another extraction attempt |
| `python3 -m compileall -q src tests` | 0 | source and tests compile |
| `make check` | 0 | repository policy and all 303 tests pass; 5 explicit environment-only skips |
| `git diff --check` | 0 | no whitespace errors |

## Changed paths and security

- Phase-9 changes stay within the SDD allowlist: readable renderer, bounded
  existing-index reads, local service routes, focused/integration tests, README,
  runbook, and this SDD evidence.
- Source membership is bound to one completed result and its immutable progress
  evidence before any content is returned. The browser uses an escaped fixed
  template, and the parser container remains network-disabled and read-only
  outside its single data mount.
- Private probes and the fresh-service rerun retained only aggregate counts,
  timings, methods, and byte ceilings. They did not persist extracted text,
  source names, private paths, or batch/source identities in this repository.
  Repository checks found no private pilot identifier.

## Final assessment

- Gate: `DEVELOPMENT_COMPLETE` for deterministic local readable results; never
  `PRODUCTION_READY`.
- External evidence still required: the representative real 70-PDF/30-image
  benchmark, owner-approved body-text/table accuracy thresholds, and rootless
  runtime evidence on the intended deployment host.
- Automatic summaries, semantic rewriting, layout-perfect tables, embedded
  images, remote access, and GitHub publication remain outside this phase.
