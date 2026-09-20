# Production document batch ingestion implementation plan

## Scope and design

Implement one local, resumable path from a strict 1–100 item manifest through
real PDF/image extraction into the existing provenance and FTS5 boundaries.
Keep the existing synthetic extractor unchanged. A new production adapter owns
dependency doctoring, per-page PDF routing, image tiling, OCR TSV validation,
and coordinate translation. A batch coordinator owns canonical ordering,
content-addressed checkpoints, isolated item failures, resume, and the bounded
summary. The CLI only wires these owned boundaries.

The local container stack is Poppler, Tesseract, Pillow, FastAPI, Uvicorn, and
python-multipart. Tool paths and versions are explicit configuration, not
PATH-based behavior during a run. No cloud, provider, publication, or promotion
capability enters the batch boundary. A read-only doctor separates host capacity
from installed-runtime readiness. The parser uses `--network none` and serves a
fixed Unix socket inside its only mounted local state root. A dependency-free,
resource-bounded relay container receives only the socket subdirectory, uses
host networking to bind exactly `127.0.0.1`, and forwards only to that Unix
socket. Docker port publishing and bridge egress are excluded; the parser never
joins the relay's network namespace. The service uses the same durable batch
API as the CLI.

Study publication is a two-phase boundary. `study export` produces a validated,
content-addressed local bundle with no Git capability. A host-side publisher
then renders that bundle into an isolated `doc_analysis_study` checkout, runs
its native `scripts/validate_repository.py`, and defaults to a local diff. Only
an explicit publish action may use the operator's existing Git/`gh` identity to
push a unique branch and open a draft PR. The upload service never receives that
identity or a writable repository mount.

The unit of publication is one coherent study, not one upload batch. An export
selects source IDs from a batch and supplies one stable slug, title, sensitivity,
and evidence cutoff. The same batch can therefore feed multiple independent
study bundles without duplicating raw bytes or coupling their review state.

## Requirement-to-evidence mapping

| Requirement | Change (component/path) | Verification (test/command) | Rollback |
|---|---|---|---|
| FR-1, FR-2, NFR-2 | `document_batch.py`, tracked config | manifest/path/bounds unit tests | remove new module/config |
| FR-3, FR-5 | `production_extraction.py` | fake-tool PDF routing and process-boundary tests | remove production adapter |
| FR-4 | `production_extraction.py` | long-image tiling/coordinate tests | disable raster formats |
| FR-6, FR-7 | production adapter and existing knowledge values | TSV, provenance, cache-forgery tests | disable cache reuse |
| FR-8, FR-9 | `knowledge_cli.py`, `document_batch.py` | subprocess batch/resume tests | remove `batch` command |
| FR-10, NFR-1, NFR-5 | batch/index integration and Unicode/production provenance compatibility | mixed-batch/index E2E plus `make check` | keep legacy CLI only |
| NFR-4 | runbook and sandbox construction evidence | local policy test; real drill external | prohibit production corpus |
| FR-11, NFR-6 | doctor script and baseline report | fixture-driven doctor test plus local run | remove doctor |
| FR-12, FR-13, NFR-7 | `document_service.py` | upload/restart/loopback API tests | retain CLI only |
| FR-14, NFR-4 | Dockerfile, build/run scripts, loopback Unix-socket relay | static/relay policy tests and container smoke | retain host doctor/CLI |
| FR-15 through FR-17, NFR-9 | study export and local sink | bundle/render/approval tests | retain batch evidence only |
| FR-18 through FR-20, NFR-8 | isolated study publisher | temporary-Git and fake-remote contract tests | retain local bundles only |

## Risks and dependencies

- Production dependencies are owner-approved as a local containerized stack:
  Poppler, Tesseract language packs, Pillow, FastAPI, Uvicorn, and
  python-multipart. Pin releases and record licenses/versions in the runbook.
- PDF and image parsers consume hostile binary formats. Enforce signature and
  size checks before parsing; use no-shell bounded subprocesses and require a
  rootless network-disabled sandbox for production evidence.
- The measured Docker 27 daemon cannot make an internal network's published
  port host-accessible and predates Docker 28's localhost-publish hardening.
  The run path therefore uses no Docker publish flag: the parser has no network,
  while a separately constrained relay container has no AF_INET connect path,
  data-tree mount, provider capability, or credentials and is tested separately.
- OCR quality varies by language, scale, compression, orientation, and layout.
  Run a representative 10-document pilot and measure non-empty page rate,
  sampled character accuracy, coordinate validity, and citation usefulness.
- Long screenshots can cause decompression bombs or high memory use. Inspect
  dimensions before full decode, enforce code-owned pixel ceilings, and tile
  with overlap.
- One global rights flag would misclassify a mixed corpus. Require per-item
  metadata in the batch manifest and retain local-only behavior for sensitive
  classes.
- Real user documents are not available in the repository. Tests use generated
  fixtures; real-corpus accuracy remains an owner-attested pilot gate.
- The generated 100-item journey uses a deterministic extractor seam so it can
  prove upload, resume, cache, result, citation, policy, and index composition
  without pretending to measure Poppler/Tesseract quality. Installed-tool
  behavior is covered separately by process-boundary tests and the pinned
  container smoke; only the owner corpus pilot can close the accuracy gate.
- The legacy index accepts only printable ASCII, synthetic OCR method names,
  and small coordinate fields. T-031 must extend that validation for bounded
  normalized Unicode, production OCR provenance, and long-image rectangles
  while preserving every existing synthetic test.
- The owner's target study checkout is outside this workflow and may change
  independently. Never mutate it; test and publish from a dedicated isolated
  checkout pinned to an operator-approved remote base.
- Git publication can leak derived private content even when originals stay
  local. Require artifact-level approval, render allowlists, a bounded diff, the
  target validator, and explicit operator action before any push.

## Migration and rollout

No existing state migration. New evidence carries a distinct production
extractor/config version and cannot reuse synthetic cache records. Roll out in
three gates: generated-fixture tests, a local ten-document representative pilot,
then the complete 100-document batch. The service is loopback-only and persists
one mounted `.ice-maker` data volume. Preserve originals outside Git; generated
runtime state remains ignored and rebuildable. Roll back by stopping the
container and retaining the existing synthetic CLI workflow and volume.
Local study export rolls back independently: retain the immutable bundle and
discard only the publisher-owned staging checkout. GitHub publication never
deletes branches or closes PRs automatically during rollback.

## Review gate

Risk is high because untrusted binary parsers, multipart upload, OCR, resource
exhaustion, and sensitive local data are involved. The orchestrator must review
every diff and rerun focused adversarial tests. Local dependency/container work
is authorized by the 2026-09-03 owner request; actual Internet exposure remains
unauthorized. Sandbox and real-corpus evidence remain external gates and block
`PRODUCTION_READY`.

## Implementation status

T-027 through T-037 are locally accepted. The generated control journey
contains exactly 70 PDF-shaped and 30 raster-shaped sources and ends with 97
processed, one duplicate, one policy rejection, and one isolated extraction
failure. Interruption/resume, service reconstruction, safe status, searchable
source/page-or-rectangle evidence, and policy preservation pass. The separate
GitHub publisher passes an offline fake remote with an exact deterministic
branch/commit/push/draft-PR contract and a real isolated-stage dry-run. Real-
corpus quality, production sandbox evidence, valid operator GitHub
authentication, and the explicit real publish action remain external gates.
