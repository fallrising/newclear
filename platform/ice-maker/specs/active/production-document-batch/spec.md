---
id: SDD-0008
title: Production document batch ingestion
status: draft
owner: fallrising
risk: high
data_class: restricted
budget_usd: 0
allowed_paths:
  - config/document-ingestion.json
  - config/study-github-publication.json
  - config/study-publication.json
  - docker/document-service.Dockerfile
  - docs/runbooks/production-document-ingestion.md
  - docs/runbooks/study-publication.md
  - pyproject.toml
  - scripts/build-document-service.sh
  - scripts/document-ingestion-doctor.sh
  - scripts/loopback-uds-proxy.py
  - scripts/publish-study.sh
  - scripts/run-document-service.sh
  - src/ice_maker/document_batch.py
  - src/ice_maker/knowledge_cli.py
  - src/ice_maker/knowledge_index.py
  - src/ice_maker/production_extraction.py
  - src/ice_maker/document_service.py
  - src/ice_maker/study_cli.py
  - src/ice_maker/study_export.py
  - src/ice_maker/study_publisher.py
  - tests/test_document_batch.py
  - tests/test_document_ingestion_doctor.py
  - tests/test_production_extraction.py
  - tests/test_production_ingestion_e2e.py
  - tests/test_knowledge_index.py
  - tests/test_document_service.py
  - tests/test_study_export.py
  - tests/test_study_publisher.py
forbidden_paths:
  - .github/workflows/**
  - orchestration/policies/**
---

# Production document batch ingestion

## Context

The current Phase 4 extractor intentionally accepts only marked synthetic PDFs
and small ASCII PBM fixtures. It cannot process the owner's expected corpus of
approximately 70 ordinary PDFs and 30 long screenshots. The existing
content-addressed store, policy classification, FTS5 index, citations, and
publication compiler remain useful downstream boundaries, but require a real,
local document adapter and a resumable batch entry point.

## Goals

- G-1: Process one manifest-declared batch of up to 100 PDF or raster-image
  documents without sending document content over the network.
- G-2: Extract native PDF text and OCR scanned PDF pages and long screenshots
  while preserving source hash, page, pixel region, extraction method, and
  confidence.
- G-3: Resume a stopped batch without repeating successful content-addressed
  extraction and produce one deterministic per-document status report.
- G-4: Feed successful chunks into the existing isolated FTS5 and unpromoted
  proposal boundaries without weakening rights, data-class, taxonomy, or
  citation controls.
- G-5: Let the owner run one local service, upload up to 100 files from a
  browser, and inspect durable batch progress and safe results.
- G-6: Publish a repeatable machine doctor and container build/run path whose
  measured result sets the supported local capability floor.
- G-7: Preserve approved analysis as a local immutable study bundle and, only
  through a separate operator action, publish that bundle to the
  `fallrising/doc_analysis_study` repository through a reviewable GitHub draft
  pull request.

## Non-goals

- Cloud OCR, external-provider transmission, automatic publication, or a
  `PRODUCTION_READY` claim.
- A chat UI, semantic vector database, polished multi-user web application, or
  unsupervised knowledge promotion. The included browser page is a local batch
  upload/status surface only.
- Password-protected PDFs, archives, office documents, handwriting guarantees,
  or layout-perfect table reconstruction in this slice.
- Silently accepting an unavailable parser, OCR language, unsupported image
  codec, oversized document, or malformed tool output.
- Committing raw uploads, private extracted text, credentials, or unapproved
  derived content to Git; direct pushes to `main`; automatic merge; or giving
  the parsing/upload service GitHub credentials.

## User stories

- As a curator, I can declare 100 relative document paths with rights, data
  class, and OCR languages, then run one local batch and see which items passed,
  were duplicates, were rejected, or failed.
- As a researcher, I can search extracted content and trace each result back to
  the exact PDF page or screenshot rectangle.
- As an operator, I can resume after interruption without repeating completed
  OCR or publishing partial evidence as success.
- As a security owner, I can keep confidential and restricted bytes local and
  fail closed on links, traversal, parser errors, resource limits, and missing
  language data.
- As the owner, I can run one doctor, build one pinned local image, start a
  loopback-only service, upload the corpus, and watch resumable progress without
  installing parser/OCR packages directly on the host.
- As a study owner, I can turn reviewed results into the native
  `doc_analysis_study` structure, inspect the exact local diff, and explicitly
  publish a branch and draft PR without exposing raw corpus data.

## Functional requirements

- FR-1: Accept a strict canonical JSON batch manifest containing 1–100 unique
  repository-external input paths relative to one explicit input root. Each item
  declares `rights`, `data_class`, and a non-empty tuple of OCR language IDs.
- FR-2: Discover only no-follow regular files below the pinned input root,
  inspect content signatures rather than extensions, and accept PDF, PNG, JPEG,
  or WebP. Reject symlinks, traversal, aliases, duplicates, and input mutation
  during a read.
- FR-3: Route each PDF page independently: preserve usable native text when
  present; otherwise rasterize only that page and OCR it. Mixed PDFs may
  therefore contain both `pdf-text` and `ocr` chunks.
- FR-4: Decode each long screenshot under explicit pixel and memory limits,
  derive a vertical tile height that satisfies both the configured height and
  per-tile pixel ceilings, split it into bounded overlapping vertical tiles,
  OCR each tile, remove only overlap-identical words, and translate every
  accepted TSV word box back to original-image coordinates. Fail closed when
  the image width leaves no valid progress-making overlapping tile.
- FR-5: Invoke only doctor-verified, explicitly configured parser/OCR
  executables with argv arrays, no shell, a minimal environment, bounded input,
  output, wall time, process group, temporary directory, and concurrency.
- FR-6: Validate UTF-8 text and TSV structure, ignore only structurally valid
  level-5 no-word rows whose text is empty after whitespace normalization,
  normalize bounded non-empty chunks to NFKC plus collapsed whitespace before
  applying secret and character-safety checks, reject secret-like output before
  proposal, and bind every chunk to the immutable source hash plus exact
  page/region/method/confidence evidence.
- FR-7: Cache successful extraction by source hash, extractor configuration
  digest, tool versions, and language tuple. A retry may reuse only a fully
  validated cache record with matching immutable inputs.
- FR-8: Add `knowledge batch --manifest <path> --input-root <path>`. Process
  items in canonical path order, isolate item failures, checkpoint atomically,
  and return non-zero unless every item is `processed` or `duplicate`.
- FR-9: Emit one canonical batch result containing counts and bounded item
  records with stable statuses: `processed`, `duplicate`, `rejected`, or
  `failed`. Never include raw document or extracted text in the summary.
- FR-10: Index only successfully extracted items, accept at most 10,000 chunks
  from one item boundary and at most 1,000,000 chunks across the 100-document
  local index, serialize concurrent readers and writers against the same index
  inode with a bounded process-safe lock, and keep all candidates `unpromoted`;
  existing human review and promotion gates remain mandatory.
- FR-11: Add a read-only `scripts/document-ingestion-doctor.sh` that emits
  human-readable output and one canonical JSON mode covering OS/architecture,
  CPU count, available memory/disk, Python, Docker daemon/security features,
  GPU availability, parser/OCR tools, installed OCR languages, and an overall
  `host-capable`, `runtime-ready`, or `unsupported` classification.
- FR-12: Add a FastAPI/Uvicorn local service with a minimal browser upload page,
  `GET /healthz`, `POST /api/batches`, and `GET /api/batches/{batch_id}`.
  Uploads use spooled/streamed multipart files, enforce item and aggregate byte
  limits while copying, sanitize names, publish an immutable manifest, return
  `202` promptly, and process through the same resumable batch boundary.
  In the container profile Uvicorn listens on one fixed Unix-domain socket;
  a dependency-free constrained relay container uses host networking only to
  accept `127.0.0.1` and can connect only to that mounted socket, so browser
  access does not give the parser an IP network or the relay the data tree.
- FR-13: Service state survives process restart, never derives truth from an
  in-memory task alone, and recovers queued/running batches as resumable. One
  process owns at most two CPU OCR workers on the measured host baseline.
- FR-14: Add idempotent build/run scripts and a pinned container definition
  containing Python 3.11, Poppler, Tesseract plus approved language data, and
  allowlisted Python dependencies. The sanitized, source-digest-bound build
  context also contains the canonical knowledge taxonomy required to initialize
  the local FTS5 index. Runtime defaults to `127.0.0.1`, no-new-privileges,
  dropped capabilities, read-only root, bounded CPU/memory/PIDs, tmpfs scratch,
  one explicit writable data volume, and `--network none`.
  The run script owns the loopback-to-Unix-socket relay lifecycle and refuses
  a port, process, socket, or container identity conflict without replacement.
- FR-15: Export exactly one coherent study per canonical immutable bundle; the
  same source batch may produce several independently reviewed study bundles.
  Export only human-approved artifacts and include a versioned manifest, study
  metadata, an explicit source-ID selection, stable source IDs and
  SHA-256 references, evidence levels, analysis Markdown, QA dispositions,
  publication decisions, artifact hashes, and the source batch/config/tool
  evidence digests. Raw source bytes and absolute local paths are forbidden.
- FR-16: Render the bundle into the existing `doc_analysis_study` contract:
  `studies/<slug>/{README.md,progress.md,sources.md,analysis/overview.md,
  analysis/qa-review.md}` plus one deterministic root-registry row. Preserve its
  status, sensitivity, evidence, supersession, and publication vocabularies.
- FR-17: A local sink publishes one complete no-replace study tree and registry
  patch to a caller-owned staging directory. It validates every output path,
  Markdown link, artifact digest, sensitive-content rule, and publication
  approval before returning success.
- FR-18: A separate operator publisher consumes only a validated bundle digest,
  uses an isolated checkout/worktree from an explicitly verified target base,
  refuses a dirty or unexpected target, applies only the study tree and registry
  row, runs the target repository's native validator, and emits an exact diff
  for approval. Re-running the same bundle is idempotent.
- FR-19: GitHub publication is an explicit second step. It is allowlisted to
  `fallrising/doc_analysis_study`, authenticates through the operator's host Git
  and `gh` configuration outside the parser container, creates a unique branch,
  commit, push, and draft PR, and never force-pushes, modifies `main`, merges,
  releases, or deploys.
- FR-20: Public content requires an artifact-level approval record. Internal or
  Restricted studies may publish only approved metadata/redacted or aggregate
  analysis; Prohibited sources produce no Git bundle. The publisher records
  bundle digest, target base, commit SHA, branch, PR URL/state, validation, and
  changed paths without secrets or raw text.

## Non-functional requirements

- NFR-1: Default to offline local execution. Document bytes, OCR text, cache,
  indexes, and checkpoints stay below ignored `.ice-maker/knowledge/` state.
- NFR-2: A tracked configuration defines hard ceilings for batch count, file
  bytes, PDF pages, decoded pixels, image dimensions, tile size/overlap, OCR
  output, subprocess duration, worker count, and total retained error records.
  Limits are checked before expensive work and cannot be raised beyond code-
  owned maxima.
- NFR-3: Batch output and retained evidence are deterministic for identical
  input bytes, manifest, configuration, and verified tool versions. Temporary
  names, absolute host paths, timestamps, and locale-dependent values are not
  evidence fields.
- NFR-4: Parsing untrusted documents occurs in an operator-provided rootless,
  network-disabled sandbox before a production-readiness claim. Local developer
  execution remains explicitly non-production evidence.
- NFR-5: Existing `knowledge ingest/extract/index/propose` synthetic behavior
  remains compatible and all repository gates stay green.
- NFR-6: The supported host floor is at least Linux x86-64, 4 logical CPUs,
  8 GiB available RAM, and 20 GiB available data-volume space. A floor pass is
  capacity evidence, not an OCR throughput claim; the installed runtime must
  benchmark a generated mixed sample before a 100-document run.
- NFR-7: The HTTP service binds only to loopback by default and has no remote-
  access claim. Non-loopback binding, authentication, TLS, reverse proxying,
  Docker port publishing is not used: the measured Docker 27 runtime cannot
  expose an internal network reliably, and its localhost-publish behavior is
  below the Docker 28 security boundary. The parser stays network-disabled and
  only the narrow relay container owns an IPv4 listening socket. It receives
  no Docker socket, credential, source tree, or data-root mount—only the fixed
  runtime socket directory.
- NFR-8: Parsing, analysis export, local repository mutation, and GitHub
  publication are separate capability boundaries. Compromise of the upload
  service cannot obtain a Git credential or invoke Git publication.
- NFR-9: Local bundles are content-addressed and remain rebuildable even if the
  GitHub repository is unavailable. GitHub failure never deletes or mutates the
  accepted local bundle.

## Acceptance criteria

Scenario: Process a representative mixed batch
Given text PDFs, scanned PDFs, a mixed PDF, PNG/JPEG/WebP screenshots, duplicate
bytes, and explicit rights/data-class/language metadata
When the curator runs `knowledge batch`
Then every supported source has immutable page or pixel-region citations,
duplicates reuse extraction, the report has exact counts, and successful text is
searchable without external network access.

Scenario: Resume a partial 100-document run
Given a canonical 100-item manifest and a run interrupted after some atomic
item checkpoints
When the same batch is invoked again
Then validated successful items are not parsed or OCRed again, unfinished items
continue in canonical order, and the final report contains exactly 100 bounded
item records.

Scenario: Preserve long-screenshot coordinates
Given a screenshot taller than one configured tile
When overlapping tiles are OCRed
Then duplicate overlap words appear once and every retained word box maps to the
correct coordinates in the original image.

Scenario: Fit long-screenshot tiles to the pixel ceiling
Given a screenshot whose configured tile height would exceed the per-tile pixel ceiling
When a smaller vertical tile can satisfy the ceiling and configured overlap
Then the derived tile height is used and the complete image is OCRed without exceeding either limit.

Scenario: Accept Tesseract no-word observations
Given valid Tesseract TSV containing bounded level-5 rows with empty text
When the OCR result is parsed
Then those rows produce no chunks and valid non-empty words are retained
And malformed coordinates, confidence, hierarchy, or unsafe non-empty text still fail closed.

Scenario: Canonicalize compatible Unicode observations
Given valid native PDF or OCR text containing bounded Unicode compatibility characters
When extraction produces indexable chunks
Then text is normalized to NFKC with collapsed whitespace before safety checks
And source, page, region, extractor, and confidence provenance remain unchanged.

Scenario: Search a multi-document index above one item ceiling
Given multiple valid documents whose combined index contains more than 10,000 chunks
When the operator searches the local FTS5 index
Then search validates and returns bounded cited results
And the separate 1,000,000-chunk whole-index ceiling remains enforced.

Scenario: Serialize concurrent shared-index publication
Given two service workers that open the same local FTS5 index concurrently
When each worker indexes a different valid source
Then both sources are committed without a transient item failure
And each constructor, transaction, and integrity read holds the same bounded
process-safe inode lock.

Scenario: Fail closed without prerequisites
Given a missing parser/OCR binary, missing requested language, malformed TSV,
oversized input, symlink, traversal, decompression-bomb image, timeout, or
changed source
When the affected item runs
Then it is rejected or failed with a stable safe reason, no success evidence is
published for that item, other declared items may complete, and the batch exits
non-zero.

Scenario: Keep sensitive material local
Given a confidential or restricted source with confirmed rights
When it is extracted and indexed locally
Then no provider callback or network command is available and any proposal
remains blocked from an external-provider boundary.

Scenario: Upload and resume through the local service
Given a host above the capability floor and a built parser/OCR image
When the owner starts the service, uploads multiple supported files, and
restarts the process during extraction
Then the upload returns a batch identifier, the status endpoint reports bounded
durable progress, and restart resumes from validated item checkpoints.

Scenario: Refuse unsafe service exposure and uploads
Given a non-loopback bind request, more than 100 files, an oversized aggregate
body, duplicate or unsafe filenames, an unsupported signature, or an incomplete
multipart stream
When the service validates startup or upload
Then it fails before batch publication and retains no partially successful
manifest.

Scenario: Save a reviewed study locally
Given reviewed findings with traceable source IDs and explicit artifact-level
publication approvals
When the owner exports a study bundle and renders it to a local staging root
Then the bundle is content-addressed, contains the complete native study
contract and deterministic registry patch, passes the target validator, and
contains no raw source bytes or absolute host paths.

Scenario: Publish a study through GitHub review
Given a validated local bundle, authenticated operator, allowlisted repository,
and verified current target base
When the operator explicitly requests GitHub publication
Then a unique branch and draft PR contain only the approved study files and
registry row, publication evidence records exact remote identities, and `main`
is unchanged until a separate human merge.

Scenario: Block an unsafe knowledge publication
Given missing rights/privacy approval, prohibited material, unapproved extracted
text, a forged bundle digest, a dirty or stale target, an unexpected repository,
target validation failure, or changed paths outside the study and registry
When local or GitHub publication is requested
Then it fails closed before push, preserves the local bundle, and emits no
credential or sensitive value.

## Failure modes

- Dependency doctor failure: stop before reading corpus bytes and report the
  missing executable, version, codec, or language identifier without fallback.
- One corrupt or unsupported source: record a safe bounded item failure and
  continue independent items; return a non-zero batch result.
- Interrupted process: retain only complete atomic checkpoints; clean private
  temporary files and resume from validated evidence.
- Cache/config/tool-version mismatch: ignore the stale entry and re-extract;
  never relabel stale evidence as a cache hit.
- Resource or timeout limit: terminate the complete subprocess group, publish no
  item success, and keep the batch resumable.
- Parser/OCR compromise: sandbox evidence remains external-pending; do not
  process untrusted production documents on an unsandboxed host.
- Service restart: recover durable queued/running state and resume; never mark
  an abandoned in-memory future successful.
- Browser/network exposure: refuse non-loopback startup without a future
  authenticated deployment profile.
- Container ingress versus egress: keep the parser at `--network none`; expose
  its fixed Unix socket only through the repository-owned loopback relay. Never
  substitute a NAT bridge, host networking, or Docker port publishing.
- Target repository conflict or GitHub failure: keep the immutable bundle,
  remove only the publisher-owned isolated worktree when safe, and require a
  new explicit operator retry; never rewrite another working tree.

## Dependency decision

Recommended local stack, pending owner approval:

- Poppler command-line tools (`pdfinfo`, `pdftotext`, and `pdftoppm`) for PDF
  inspection, native text, and page rasterization.
- Tesseract with explicitly installed language data for OCR and TSV bounding
  boxes.
- Pillow with only PNG, JPEG, and WebP codecs allowlisted for signature-bound
  image decoding, limits, and vertical tiling.
- FastAPI, Uvicorn, and python-multipart for bounded multipart upload and the
  local ASGI service.

No dependency will be installed or added to `pyproject.toml` until the owner
accepts its licensing, security, maintenance, and deployment cost. Cloud OCR is
not an implicit fallback.

## Open questions

- OQ-1 (`fallrising`, resolved 2026-09-03): use a fully local containerized
  Poppler + Tesseract + Pillow + FastAPI stack; infrastructure installation and
  configuration are delivered as scripts, with no cloud OCR fallback.
- OQ-2 (`fallrising`, before the real-corpus pilot): identify required OCR
  languages, expected maximum file size/page count/image dimensions, and whether
  any files are untrusted, confidential, or restricted.
- OQ-3 (`fallrising`, before rollout): select the primary first outcome among
  local search, cited knowledge candidates, or book/report generation so pilot
  quality metrics match actual use.
- OQ-4 (`fallrising`, before the real-corpus pilot): confirm whether Traditional
  Chinese plus English (`chi_tra+eng`) is the minimum language set; the image may
  include additional language packs only by explicit configuration.
- OQ-5 (`fallrising`, at each study export): supply the stable study slug/title,
  sensitivity, evidence cutoff, and source-ID selection. The design decision is
  one coherent study per immutable bundle; one batch may yield several bundles
  rather than coupling unrelated systems into one repository entry.

## Current acceptance state

The local implementation through T-037 is `DEVELOPMENT_COMPLETE`. A generated
control journey proves exactly 100 bounded item results, durable interruption
and resume, duplicate cache reuse, isolated failures, searchable provenance,
the loopback service boundary, and safe status output. It deliberately uses a
deterministic extractor seam; therefore it is control evidence rather than a
claim about OCR accuracy or the owner's documents. The pinned real container
has passed a local build, health request, runtime-policy inspection, and
idempotent restart check. GitHub draft-PR publication passes an offline fake-
bare-remote E2E and a real isolated-checkout dry-run; no real GitHub action was
taken. Owner-corpus pilot measurements, rootless sandbox evidence, owner
policy/quality attestation, valid GitHub authentication, and an explicit
operator publish remain external actions. No `PRODUCTION_READY` status is
claimed.
