# Production document batch ingestion verification

## Environment and source

- Spec: `specs/active/production-document-batch/spec.md`
- Base SHA: `91d60a5e8b32926632f687b3601506192afee896`
- Verification time (UTC): `2026-09-03T17:52:34Z`
- Data/provider classification: generated fixtures plus one local
  `unconfirmed`/`restricted` real-corpus pilot; no provider

## Acceptance evidence

| Criterion | Status (pass/fail/not-tested) | Command or evidence ID | Exit code | Notes |
|---|---|---|---:|---|
| Host/runtime capability doctor | pass | T-027; `scripts/document-ingestion-doctor.sh --json` | 1 | expected `host-capable`; 6 CPUs, about 16 GiB available memory, 147 GiB free disk, Docker/cgroup v2/seccomp/AppArmor pass; pinned container supplies the absent host parsers |
| Strict batch contracts and path/bounds controls | pass | T-028; focused and full gates | 0 | 16 focused tests; pinned descriptor/race probes and 212-test full gate pass |
| Long-image tiling, OCR, and coordinates | pass | focused tests plus private pilot | 0 | 16 focused tests; width-aware tiling processed a 2607x12185 screenshot and all real screenshot rectangles remained in bounds |
| Native/scanned/mixed PDF extraction | pass | focused tests plus private pilot | 0 | one 9-page scanned PDF and one 37-page native PDF processed; native text matched 37/37 pages and 5,973 normalized characters |
| Atomic resume and bounded report | pass | T-031; focused and full gates | 0 | 44 focused tests and 238-test full gate; explicit local toolchain, cache/progress forgery rejection, failure isolation, exact OCR rectangles, and Traditional Chinese FTS5 pass |
| Multi-document FTS5 capacity | pass | focused tests plus private pilot search | 0 | separate 10,000 item-boundary and 1,000,000 whole-index ceilings; 16,168 real chunks are searchable with complete citations; concurrent readers/writers use one bounded inode lock |
| Loopback upload service and recovery | pass | T-032; 20 focused host tests and pinned-container multipart test | 0 | durable attempts, bounded status, exact metadata, restart recovery, and loopback-only API pass |
| Constrained container build/run | pass | real pinned build, health request, inspection, and idempotent re-run | 0 | parser network none, read-only root, all capabilities dropped; socket-only relay; image revision `a2705a62e0aae3aeb6ae3b1e7d6b7c07f97701acae570ae71f476e0268244e44` |
| Generated 70-PDF/30-image E2E | pass | T-034; `tests.test_production_ingestion_e2e` | 0 | exactly 100 items: 97 processed, 1 duplicate, 1 rejected, 1 failed; deterministic seam is control evidence only |
| Approved local study export | pass | T-035; 13 focused tests | 0 | exact six-artifact immutable bundle, source/chunk/QA/approval ledger, no raw or absolute paths |
| Isolated `doc_analysis_study` publication | pass | T-036; 9 focused tests and isolated target-native validation | 0 | exact six paths at true base `ad28e5c`; target validator passed with 4 studies/104 Markdown files; owner checkout stayed clean |
| GitHub branch/draft-PR publication | pass | T-037; fake bare remote E2E plus isolated real-stage dry-run | 0 | exact branch/commit/non-force push/draft PR and replay pass offline; operator GitHub auth was later verified for repository PR #2, but no restricted study bundle was published |
| Representative real-corpus pilot | pass | local aggregate evidence; details in runbook | 0 | 10/10 processed in 247.713 seconds; 58/58 selected topic terms, 21/22 scanned section-heading phrases, zero coordinate violations, and byte-stable idempotent resubmission |

## Checks run

| Command | Exit code | Result |
|---|---:|---|
| `PYTHONPATH=src python3 -m ice_maker validate production-document-batch` | 0 | SDD is valid |
| `make check` | 0 | repository policy and all 188 existing tests pass |
| `git diff --check` | 0 | no whitespace errors |
| `bash -n scripts/document-ingestion-doctor.sh` | 0 | shell syntax passes |
| `PYTHONPATH=src python3 -m unittest tests.test_document_ingestion_doctor -v` | 0 | all 8 capability regressions pass |
| `scripts/document-ingestion-doctor.sh --json` (Docker-enabled host) | 1 | expected `host-capable`; cgroup v2, seccomp, and AppArmor detected independently |
| `PYTHONPATH=src python3 -m unittest tests.test_document_batch -v` | 0 | all 16 batch-contract regressions pass |
| `PYTHONPATH=src python3 -m unittest tests.test_document_batch tests.test_document_ingestion_doctor -v` | 0 | all 24 Phase-8 foundation regressions pass |
| `make check` after T-028 | 0 | repository policy and all 212 tests pass |
| `PYTHONPATH=src python3 -m unittest tests.test_production_extraction -v` | 0 | all 9 raster decode/tiling/OCR adapter regressions pass |
| `PYTHONPATH=src python3 -m unittest tests.test_production_extraction tests.test_extraction tests.test_document_batch -v` | 0 | all 32 focused and compatibility regressions pass |
| `python3 -m py_compile src/ice_maker/production_extraction.py tests/test_production_extraction.py` | 0 | production raster adapter and tests compile |
| `make check` after T-029 | 0 | repository policy and all 221 tests pass |
| `PYTHONPATH=src python3 -m unittest tests.test_production_extraction -v` after T-030 | 0 | all 15 image/PDF extraction regressions pass |
| `PYTHONPATH=src python3 -m unittest tests.test_production_extraction tests.test_extraction tests.test_document_batch -v` | 0 | all 38 focused and compatibility regressions pass |
| `python3 -m py_compile src/ice_maker/production_extraction.py tests/test_production_extraction.py` | 0 | production extraction adapter and tests compile |
| `make check` after T-030 | 0 | repository policy and all 227 tests pass |
| `PYTHONPATH=src python3 -m unittest tests.test_document_batch tests.test_knowledge_index tests.test_knowledge_e2e -q` after T-031 | 0 | all 44 batch, index, and legacy knowledge regressions pass |
| `make check` after T-031 | 0 | repository policy and all 238 tests pass |
| `PYTHONPATH=src python3 -m unittest tests.test_production_ingestion_e2e -v` | 0 | generated exactly 70 PDF-shaped and 30 image-shaped inputs; resume and final 100-item result pass |
| `make check` after T-034/T-036 | 0 | repository policy and all 281 tests pass; 4 host-sandbox-only tests skip with explicit reasons |
| `PYTHONPATH=src python3 -m unittest tests.test_study_publisher -v` after T-037 | 0 | 14 tests cover local staging plus fake remote success/replay, stale base, branch/push/PR failures and collisions, strict config, dry-run, tamper, secret, timeout, and partial evidence |
| `scripts/publish-study.sh ...` against the T-036 isolated real-target staging checkout | 0 | dry-run only; branch `study/ice-maker-runtime-study-4fec13b757c3`, exact six paths, base `ad28e5c`, diff `1a439d...`, no prepared marker or remote mutation |
| `make check` after T-037 | 0 | repository policy and all 286 tests pass; 4 explicit environment-only skips |
| `PYTHONPATH=src python3 -m unittest tests.test_production_extraction -v` after real-pilot fixes | 0 | all 16 raster/PDF regressions pass, including valid empty Tesseract rows, NFKC normalization, and width-aware tile derivation |
| `PYTHONPATH=src python3 -m unittest tests.test_knowledge_index -v` after real-pilot fixes | 0 | all 17 index regressions pass, including 10,001-row search and whole-index rollback at the configured ceiling |
| final private local upload/status/search/resubmit | 0 | 10/10 processed; 16,168 chunks searchable; identical upload returned the same ID in 0.27 seconds without changing result/cache/progress evidence |
| `make check` after real-pilot fixes | 0 | repository policy and all 289 tests pass; 4 explicit environment-only skips |
| deterministic T-042 concurrent-constructor RED before fix | 1 | second constructor crossed into SQLite while the first still owned initialization; the pre-fix 50-run service reproducer emitted `index_failed` on attempt 7 |
| `PYTHONPATH=src python3 -m unittest tests.test_knowledge_index -v` after T-042 | 0 | all 19 tests pass, including serialized concurrent open and bounded lock timeout |
| T-042 three-batch/two-worker reproducer after fix | 0 | 50/50 runs completed with no failed item |
| final `make check` after T-042 | 0 | repository policy and all 303 tests pass; 5 explicit environment-only skips |
| `PYTHONPATH=src python3 -m ice_maker validate production-document-batch` | 0 | living SDD is valid after runbook and evidence updates |
| `python3 -m compileall -q src tests` | 0 | source and tests compile |
| `git diff --check` | 0 | no whitespace errors |

## Changed paths and security

- Changed files: production batch SDD and runbook, production raster/PDF and
  FTS5 boundaries, container packaging, and focused extraction/index/container tests
- Allowlist check: pass for the documentation-first scope
- Symlink/path escape check: T-027/T-028 pass, including deterministic
  intermediate-input and checkpoint-directory swap regressions
- Secret scan: pass through `make check`

## Final assessment

- Gate: DEVELOPMENT_COMPLETE through T-037 plus the representative local
  ten-document calibration pilot; never `PRODUCTION_READY`
- External evidence still required: a 70-PDF/30-image representative benchmark,
  owner-approved body-text/table accuracy thresholds, and rootless-runtime
  evidence on the intended deployment host
- Risks and open questions: see OQ-2 through OQ-4 in `spec.md`; the bounded
  raster/PDF adapters now have real Poppler/Tesseract pilot evidence, but the
  scanned PDF's mean OCR confidence was 0.586 and its body text, code, and tables
  still require human review before knowledge promotion; shared index access is
  serialized with a five-second process-safe lock; the 100-item generated test
  remains control evidence rather than a representative capacity benchmark
