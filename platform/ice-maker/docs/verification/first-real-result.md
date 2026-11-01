# First real-document result: local pilot passed

Observation date: 2026-10-04 (UTC). Status: `LOCAL_DEV` usable; knowledge
candidates remain unpromoted. A private candidate Draft PR has been created
for owner review.

## Current acceptance

The owner-selected English PDF completed the existing real upload, native
extraction, private provenance/index, and readable-result flow at code revision
`0038175b9a82a98c02fb9b64688cae243e9f2ad3`, against clean main
`c5fe7385d7021cc071c5dc793437a911044aa380`. Raw identity was revalidated and the
latest source registry/inventories were checked before ingestion. Original
bytes, source identity, account details, full extraction, batch/index/chunk
identifiers, and detailed citation evidence remain private.

| Stage | Actual result |
| --- | --- |
| Environment gate | Doctor `host-capable`, exit 1; verified pinned container supplies the runtime stack |
| Real upload and ingestion | One processed document; zero duplicate, rejected, or failed items |
| Extraction/OCR decision | 81 of 81 physical pages have non-empty native text; no OCR was needed or executed |
| Private index | 81 chunks; 174,832 normalized characters and 176,138 UTF-8 bytes |
| Provenance | Immutable source, page/text range, cache, progress, and index bindings validate |
| Readable result | Markdown 185,992 bytes; escaped HTML 191,864 bytes; both below 256 KiB |
| Reproducibility | Repeated listing/Markdown/HTML are identical; an identical real re-upload preserves batch/result/Markdown |
| Knowledge candidate | Ten existing `KnowledgeIndex.propose` calls succeeded; 33 supporting anchors selected and reviewed; private Draft PR created; all candidates unpromoted |

## Environment and runtime evidence

The current host has six logical CPUs, approximately 9.12 GiB available memory,
more than 20 GiB free data space, and Docker 29.1.3 with AppArmor, seccomp, and
cgroup v2. The doctor returns exit 1 because host parser/service packages are
absent; this is the documented container-supplied `host-capable` route. Initial
unsupported observations were resolved through host capacity, AppArmor/securityfs,
Docker, and non-root operator preparation, without lowering the doctor floor.

The operator and parser are non-root; the Docker daemon is rootful. The parser
runs as UID 1000 with network mode `none`, read-only root, all capabilities
dropped, `no-new-privileges`, AppArmor `docker-default`, and configured 8 GiB
memory, two CPU, and 256 PID limits. The relay remains loopback-only and has no
document-data mount. These are measured local controls, not rootless-production
evidence.

| Runtime identity | Observed value |
| --- | --- |
| Code revision | `0038175b9a82a98c02fb9b64688cae243e9f2ad3` |
| Source-derived image revision | `33c044d838213d000ca6d56b27b710a6a5f9411de845f73c2ce200b717319bcd` |
| Image ID | `sha256:8138613aa0d1bf29d2f2c123c3307ca673886623658fe1408686026c4fd66c98` |
| Container Python / Poppler / Tesseract | `3.11.15` / `25.03.0` / `5.5.0` |
| Pillow / FastAPI / Uvicorn / python-multipart | `12.3.0` / `0.141.1` / `0.52.4` / `0.0.32` |
| PDF extractor | `production-pdf-v3`; native `pdftotext -layout` |
| Language policy | Document `eng`; image includes `chi_tra`, `eng`, `osd`; zero OCR pages |

## Output quality and citation checks

All 81 pages matched a separate bounded Poppler `-layout` extraction after the
same normalization. Page coverage is complete and every native text range is
contiguous. Twelve rendered original pages were inspected across sections;
checks included prose order, highlighted code, constructor arguments, selector
logic, chained calls, and suspected extraction anomalies. Visual review exposed
a defect that equality with the original default-mode extractor would not have
found: highlighted code punctuation and arguments could move after later
statements. The repaired extraction restores the reviewed code order, including
four problematic sampled pages; it retains the existing normalized text contract
and does not preserve indentation or promise layout-perfect tables.

The candidate uses existing proposal and citation binding APIs. Each of ten
major conclusions has selected supporting evidence; 33 anchors were checked
against their actual page/chunk/range locations and the reviewed source. Source
observations, interpretation, inference, and historical limits remain distinct.
A private candidate Draft PR has been created for owner review; candidates
remain unpromoted. No promotion or approval of the document's historical
JavaScript techniques is inferred from extraction.

## Defects and current verification

- The existing Poppler `-v` doctor fix was retained and rerun; installed tools
  were verified inside the pinned runtime.
- The credential matcher rejected ordinary lexer code. Eight RED controls
  produced six expected errors before the minimal shared text predicate fix.
  Narrow method-header and complete nullary lexical-call forms are accepted;
  credential values/aliases, nested assignments, unsafe Unicode, and ambiguous
  expressions still fail closed. Executable/version metadata keeps its original
  strict matcher.
- Default native reading order displaced syntax-highlighted code. Three RED
  regressions failed on semantic ordering, legacy PDF cache reuse, and outer
  toolchain version binding. The fix adds `-layout`, bumps the PDF extractor to
  v3, and includes that version in the outer digest. The accepted run uses a
  fresh private state/index to avoid mixing old immutable extraction chunks.
- The prior Pillow-absence test assumed a missing installed dependency. The
  PR now explicitly mocks the missing-codec condition and continues to test
  installed-Pillow decode failures; no valid test was removed or skipped.

Commands run from the component root with the recorded isolated non-root test
runtime. Local logs and exact private journey commands remain outside Git.

| Check | Exit | Actual result |
| --- | ---: | --- |
| Lexical-code regression before fix | 1 | Eight tests run, six expected errors |
| Ordering/PDF cache/outer binding regressions before fix | 1 | Three tests run, three expected failures |
| `PYTHONPATH=src python3 -m unittest tests.test_production_extraction tests.test_document_batch tests.test_text_assignment_safety tests.test_knowledge_index tests.test_document_ingestion_doctor -v` | 0 | 81 focused tests pass |
| `PYTHONPATH=src python3 -m unittest tests.test_document_ingestion_doctor -v` | 0 | Ten tests pass |
| `make check` at the committed PR revision | 0 | 317 tests pass; zero failures, errors, or skips |
| `make check` at clean main baseline | 2 | 303 run: 302 pass, one reproduced Pillow-absence assumption failure; zero errors or skips |
| `PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e tests.test_publication_e2e -v` | 0 | Three synthetic control tests pass; control evidence only |
| `PYTHONPATH=src python3 scripts/check_repo.py` | 0 | Repository policy gate passes |
| `PYTHONPATH=src python3 -m ice_maker validate production-document-batch` and `validate readable-document-results` | 0 | Both living specifications validate |
| `sha256sum -c docs/execution/sdd-source.sha256` | 0 | All 11 immutable source hashes match |
| `bash -n` on doctor/build/run/publication scripts | 0 | All four shell syntax checks pass |
| `python3 -m compileall -q src tests` | 0 | Compilation passes |
| Worktree/staged/actual PR `git diff --check` | 0 | All three whitespace checks pass |

All 15 checks recorded for the clean committed PR checkout exited zero; the
source revision and checkout content remained unchanged. Full tests used Python
3.14.4, while real parsing used the pinned container's Python 3.11.15. The clean
baseline failure was freshly reproduced in the same test environment, not
copied from the historical attempt.

## Remaining review and external gates

The local real-document result is accepted for this reviewed sample. A private
candidate Draft PR is available for owner review; knowledge promotion remains a
human review gate. Rootless production, representative 100-document capacity,
formal body/table quality thresholds, and OCR accuracy remain unverified by this native-only
pilot. No merge, deployment, provider ingestion, or `PRODUCTION_READY` claim was
performed. Use the existing [production ingestion runbook](../runbooks/production-document-ingestion.md)
with a fresh private data root when extractor semantics change.

The historical blocked attempt is retained below. Machine-readable evidence is
maintained in [first-real-result.json](first-real-result.json).

## Historical attempt: blocked at runtime preflight

Observation date: 2026-10-03 (UTC).

### Outcome

The owner-selected PDF was acquired intact (676,301 bytes) and its SHA-256 was
recorded in the private task evidence. The current study registry and source
inventories contained no matching document. Raw bytes, source-account details,
and full extraction text are not published here.

The real-document workflow did **not** reach ingestion. No batch, OCR result,
provenance index, readable result, citation-backed candidate, or knowledge PR
was produced. This is a blocked attempt, not a successful real-corpus pilot.
Machine-readable task evidence is in [first-real-result.json](first-real-result.json).

### Defect and fix

The doctor reported all three installed Poppler tools as unavailable. It passed
`--version` to every tool; the installed `pdfinfo`, `pdftotext`, and `pdftoppm`
accept `-v` instead. Direct probes returned Poppler 24.02.0 successfully.

A regression with executables that enforce the real flag contract failed before
the fix: three `false` tool observations instead of `true`. The minimal fix makes
the version flag explicit for Poppler and retains `--version` for Tesseract.
A second regression confirms a nonzero version probe remains unavailable.
Docker, language, package, and isolation checks have not been bypassed.

### Verification

Commands below run from the component root unless noted. Check output summaries
are retained in the JSON evidence; local logs containing temporary paths stay
outside Git.

| Check | Exit | Observed result |
| --- | ---: | --- |
| New strict version-flag regression, before fix | 1 | Expected RED: all three Poppler observations were false |
| `PYTHONPATH=src python3 -m unittest tests.test_document_ingestion_doctor -v` | 0 | 10 tests pass |
| `DOCTOR_OCR_LANGUAGES=eng scripts/document-ingestion-doctor.sh --json` | 2 | Poppler and English OCR detected; host remains unsupported |
| `scripts/run-document-service.sh <private-data-directory> 18080` | 77 | `run as a non-root operator`; no service started |
| `make check` at unchanged base `7b29dceac92fb5e62490662f78b0f630d66423d0` | 2 | 303 run: 293 pass, 3 failures, 2 errors, 5 skips |
| `make check` after fix | 2 | 305 run: 295 pass, same 3 failures, 2 errors, 5 skips |
| `PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e tests.test_publication_e2e -v` | 0 | 3 tests pass; synthetic control evidence only |
| `PYTHONPATH=src python3 scripts/check_repo.py` | 0 | Policy/schema/source/secret-pattern gate passes |
| `sha256sum -c docs/execution/sdd-source.sha256` | 0 | All immutable source-pack hashes match |
| `bash -n scripts/document-ingestion-doctor.sh` | 0 | Shell syntax passes |
| `python3 -m compileall -q src tests` | 0 | Compilation passes |
| `git diff --check` | 0 | No whitespace errors |

The five unchanged failing/erroring cases are:

- `test_red_signature_codec_digest_and_decode_limits`: assumes Pillow is absent
  and expects `image codec unavailable`; with Pillow installed the deliberately
  invalid image correctly fails with `image decode failed`.
- `test_github_command_timeout_and_partial_evidence_are_stable`
- `test_github_fake_remote_publish_and_replay_are_exact`
- `test_github_dry_run_and_script_do_not_mutate_checkout_or_remote`
- `test_github_stale_remote_collision_and_pr_retry_preserve_local_evidence`

The four publication cases encounter the configured executable-identity gate
because `gh` is absent. These tests were not weakened or relabelled as passing.
Three container/relay tests skip because filesystem Unix sockets are forbidden;
two HTTP tests skip because service extras are absent. The full verification
gate remains unresolved even though the focused doctor regression is green.

### External gates and resumption

After the fix, the real host doctor still reports Docker unreachable and missing
service packages. The runner is root, and the existing startup script rejects
it before starting any container. Default `eng,chi_tra` probing also reports
the missing Traditional Chinese language; explicit `eng` probing succeeds for
this English sample without changing the tracked defaults.

Resume on a supported non-root operator host using the existing
[production ingestion runbook](../runbooks/production-document-ingestion.md).
Recheck source identity and study duplication, run doctor, build the pinned
image, verify parser isolation, and run the real upload/status/readable journey.
Then verify page/chunk provenance and content quality, test deterministic reuse,
and prepare the cited knowledge candidate. Do not replace the missing runtime
with synthetic extraction or an unisolated alternate pipeline.

No merge, deployment, production-readiness assertion, or knowledge promotion
was performed. The pending full-suite environment and test-portability issues
must be resolved or explicitly assessed on that supported host.
