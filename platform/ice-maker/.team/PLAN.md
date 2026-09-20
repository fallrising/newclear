# Full SDD Build Execution Plan

## Objective

Build the Personal Engineering Knowledge Compiler through Phase 0–7 on
`build/full-sdd`. During the orchestration run, preserve one private draft PR
and do not push `main`, merge, or deploy. After the run completed, repository
owner `fallrising` merged PR #1 on 2026-09-03; no deployment was performed or
inferred from that merge.

## Fixed inputs

- Repository: `fallrising/ice-maker` (private)
- Integration branch: `build/full-sdd`
- Source SDD: `docs/sdd/` (immutable copy; hashes in
  `docs/execution/sdd-source.sha256`)
- Final local status ceiling without real infrastructure evidence:
  `DEVELOPMENT_COMPLETE`

## Phase plan

| Phase | Observable gate | Status | Checkpoint |
|---|---|---|---|
| Bootstrap | private repo, source copy, root rules, plan, draft PR | complete | `a91d213` |
| 0 | decisions, threat controls, schemas, provider/data policy | local pass; external pending | `b3b90f9` |
| 1 | deterministic `sdd init/new/validate/status` lifecycle | complete | `2588fe6` |
| 2 | bounded single-agent execution and PR evidence | local pass; external pending | `6877da7` |
| 3 | two verified adapters, routing, budgets, independent review | local pass; external pending | `91237ec` |
| 4 | synthetic text/scanned PDF ingestion with provenance | local pass; external pending | `ea1b61d` |
| 5 | synthetic knowledge promotion and integrity reports | local pass; external pending | `18e4596` |
| 6 | reproducible Markdown/HTML publication | local pass; external pending | `9d0127a` |
| 7 | hardening, recovery, observability, operational evidence gates | local pass; external pending | `f8fb2ea` |
| 8 | real PDF/image batch service plus local/GitHub study publication | 10-document local pilot passed; 100-document and production gates pending | — |
| 9 | human-readable reconstructed document results | local development complete; external gates pending | — |

## Task ledger

| Task | Phase | Agent | Scope | Status | Decision |
|---|---:|---|---|---|---|
| T-001 | 0 | codex-cheap | ADRs and risk decisions | accepted | ACCEPT after provider-boundary reassignment |
| T-002 | 0 | codex-cheap → codex-terra | protected governance paths | accepted | ACCEPT after report-only escalation |
| T-003 | 0 | codex-cheap | templates and JSON schemas | accepted | ACCEPT after one interrupted-report retry |
| T-004 | 0 | codex-cheap → codex-terra | repository-native Phase 0 gate | accepted | ACCEPT after scanner rework and report-only escalation |
| T-005 | 1 | codex-cheap → codex-terra | constrained front matter and SDD validation | accepted | REASSIGN after failed rework; ACCEPT after Terra fix |
| T-006 | 1 | codex-cheap → codex-terra | deterministic lifecycle CLI | accepted | ACCEPT after symlink/title rework and atomic no-replace escalation |
| T-007 | 1 | codex-cheap | CI-equivalent active-SDD validation | accepted | ACCEPT after governed-file symlink rework |
| T-008 | 2 | claude → codex-terra → codex-strong | contract, bounded execution, redaction, path policy | accepted | ACCEPT after two security reworks and strong escalation |
| T-009 | 2 | cursor-grok high/xhigh → codex-terra → codex-strong | worktree, sandbox, first adapter | accepted | ACCEPT after two security reworks and strong escalation |
| T-010 | 2 | codex-cheap → codex-terra | orchestration and PR evidence | accepted | ACCEPT after Terra lifecycle-state reassignment |
| T-011 | 3 | codex-terra → codex-strong | OpenCode and read-only review adapters | accepted | ACCEPT after real CLI rework and atomic publication escalation |
| T-012 | 3 | codex-cheap | alias routing and usage ledger | accepted | ACCEPT after alias/policy/ledger rework |
| T-013 | 3 | codex-terra → codex-strong | sequential independent-review pipeline | accepted | ACCEPT after typed-boundary rework and cost/evidence escalation |
| T-014 | 4 | codex-cheap → codex-terra | content-addressed intake and taxonomy | accepted | ACCEPT after Terra content-derived validation |
| T-015 | 4 | codex-terra | synthetic PDF/PBM extraction and OCR cache | accepted | ACCEPT after cache trust-boundary rework |
| T-016 | 4 | codex-cheap → codex-terra | FTS5 retrieval and cited proposals | accepted | ACCEPT after FTS integrity reassignment |
| T-017 | 4 | codex-terra → codex-strong | four-stage CLI and two-PDF E2E | accepted | ACCEPT after provenance rework and maintainability review |
| T-018 | 5 | codex-cheap | retrieval, comparison, and integrity reports | accepted | ACCEPT after provenance/bounded-report rework |
| T-019 | 5 | codex-terra → codex-strong | digest-bound promotion and human gate | accepted | ACCEPT after replay rework and immutable-value escalation |
| T-020 | 5 | codex-terra | synthetic horizontal comparison E2E | accepted | ACCEPT after failure-atomic and sealed-journey rework |
| T-021 | 6 | codex-cheap | pure manifest/compiler/renderers | accepted | ACCEPT after commit-boundary and canonical-invariant rework |
| T-022 | 6 | codex-terra → codex-strong | confined all-or-nothing build boundary | accepted | ACCEPT after pinned-descriptor strong escalation |
| T-023 | 6 | codex-cheap → codex-strong | two-book shared-knowledge rebuild | accepted | ACCEPT after narrow-cleanup rework and unique-sentinel escalation |
| T-024 | 7 | codex-terra → codex-strong | observability, quotas, and evidence semantics | accepted | ACCEPT after directional/evidence rework and descriptor/invariant escalation |
| T-025 | 7 | claude → codex-strong | hardening contracts and local drills | accepted | ACCEPT after race/symlink rework and complete invariant escalation |
| T-026 | 7 | codex-cheap → codex-strong | complete local hardening journey | accepted | ACCEPT after evidence-gating rework and report/runbook escalation |
| T-027 | 8 | codex-cheap | reproducible host/runtime capability doctor | accepted | ACCEPT after REWORK 1: 8 focused tests and Docker-enabled real run prove `host-capable`; host parser/OCR runtime remains absent |
| T-028 | 8 | codex-cheap → codex-terra → codex-strong | batch manifest/config/result contracts | accepted | ACCEPT after Terra streaming/alias work and strong pinned-descriptor, immutable-value, result-binding, and checkpoint-race hardening |
| T-029 | 8 | codex-terra → codex-strong | long-image decode, tiling, and OCR adapter | accepted | ACCEPT after integrated-path rework and strong public-invariant, UTF-8 byte-bound, tracked-dimension, and real subprocess hardening |
| T-030 | 8 | codex-terra → codex-strong | native/scanned/mixed PDF extraction | accepted | ACCEPT after Poppler-contract rework and strong UTF-8 metadata plus descriptor-pinned raster-read hardening |
| T-031 | 8 | codex-cheap → codex-terra → codex-strong | resumable batch CLI, production FTS5 compatibility, and safe report | accepted | ACCEPT after strong explicit-toolchain, isolated discovery, bound cache/progress, exact OCR citation, and adversarial Unicode/state review |
| T-032 | 8 | codex-terra → codex-strong | loopback upload service and restart recovery | accepted | ACCEPT after strong explicit-policy, no-replace, descriptor-state, durable-attempt, and real multipart rework |
| T-033 | 8 | codex-cheap → codex-strong | constrained container and build/run scripts | accepted | ACCEPT after strong pinned-image, network-none parser, isolated relay, and real build/smoke rework |
| T-034 | 8 | codex-cheap → cursor-grok → codex-strong | 100-document service E2E and operator runbook | accepted | ACCEPT after failed worker retries and strong RED/GREEN completion |
| T-035 | 8 | codex-terra → codex-strong | approved local `doc_analysis_study` export bundle | accepted | ACCEPT after strong chunk-ledger, exact approval, native rendering, pinned-descriptor, collision, and safe-output rework |
| T-036 | 8 | codex-terra → codex-strong | isolated local study-repository publication | accepted | ACCEPT after strong base-preserving offline snapshot, exact diff, hostile Git/filesystem, and real target-validator rework |
| T-037 | 8 | codex-terra → codex-strong | explicit GitHub branch and draft-PR publication | accepted | ACCEPT after fake-remote E2E and real-stage dry-run; no real GitHub action |
| T-038 | 9 | codex-cheap → codex-strong | readable-result living specification | accepted | ACCEPT after schema/allowlist/task-boundary review and strong refinement |
| T-039 | 9 | codex-cheap → codex-strong | deterministic reconstruction, Markdown API, and browser reader | accepted | ACCEPT after strong TDD completion and real FastAPI container checks |
| T-040 | 9 | codex-cheap → codex-strong | integrated journey and operator documentation | accepted | ACCEPT after duplicate-identity semantics and per-source ceiling wording were corrected |
| T-041 | 9 | codex-strong | private-pilot runtime validation and final quality gate | accepted | 10/10 retained documents reconstruct within bounds; final 303-test and container gates pass |
| T-042 | 8/9 | codex-strong | serialize concurrent shared-index initialization and publication | accepted | deterministic RED, bounded timeout, 50-run reproducer, full and container gates pass |
| T-043 | 9 | codex-strong | fresh private-corpus readable-result service rerun | accepted | 10/10 fresh extraction and all listing/Markdown/HTML/idempotency checks pass |

## Decisions and discoveries

- 2026-09-04: ACCEPT T-043 after rebuilding source revision `832ce5d...`,
  preserving the prior private state, and starting a fresh isolated loopback
  service. The same 10 files completed from an empty cache in about 546 seconds
  with 0 failures and produced 54 pages and 16,168 chunks. The 2,458-byte
  listing exposed no filename, path, or text; all 10 Markdown and HTML results
  were deterministic and below 256 KiB; unknown-source access returned the
  stable safe 404; and 5,405 low-confidence OCR markers make the human-review
  burden visible. An identical resubmission reused the same batch in 0.304
  seconds. Only aggregate evidence enters Git; the healthy test service remains
  loopback-only, network-disabled in the parser, and available for local review.

- 2026-09-04: T-042 opened after a required final `make check` repeat exposed
  one intermittent `index_failed` in the same-manifest isolation journey. A
  50-run reproducer confirmed the product defect on attempt 7: two service
  workers could enter SQLite initialization for the shared index concurrently,
  leaving one otherwise valid source failed. The deterministic RED test now
  holds the first constructor before SQLite open and proves that the second
  cannot cross that boundary. The fix locks the validated database inode with
  a five-second process-safe shared/exclusive lock for the complete connection
  lifetime. The RED test, 50-run reproducer, 50 focused tests, and the retained
  ten-document read-only probe now pass. ACCEPT after the final repository gate
  passed 303 tests with five explicit host-environment skips and the pinned
  container passed all thirteen selected tests without skips.

- 2026-09-04: ACCEPT T-041 and close the local Phase-9 gate. A descriptor-backed
  read-only probe reconstructed all ten retained private-pilot sources without
  printing document text, producing 16,168 chunks across `ocr` and `pdf-text`; maximum
  Markdown and HTML sizes were 112,254 and 113,420 bytes, below their 256 KiB
  ceilings. The full repository gate passes 303 tests with five explicit host
  environment skips, while the pinned network-disabled/read-only container
  passes all thirteen HTTP/renderer/index-lock tests without skips. The running local
  containers were inspected as healthy and were not stopped, replaced, or
  deployed. External 100-document representative capacity, formal body/table
  quality thresholds, and rootless-host evidence remain open.

- 2026-09-04: ACCEPT T-040 after orchestrator integration and review. The
  generated 70-PDF/30-image journey lists 97 processed source identities and
  deterministically reconstructs native, OCR, and deduplicated content while
  failed, rejected, and foreign sources share the safe 404 result. Review
  corrected the worker's initial claim that a duplicate identity itself returns
  404: identical processed bytes appear once and resolve to that shared source.
  The runbook now states the 10,000-chunk ceiling per source and documents
  listing, escaped preview, download, bounds, and stable errors. Ten integrated
  tests and the living SDD validator pass.

- 2026-09-04: Phase 9 starts from the measured user-facing gap after the
  ten-document pilot: extracted content is searchable and semantically useful,
  but users cannot directly read or download a reconstructed document from the
  local service. The smallest slice will expose completed, processed sources
  only; reconstruct native text by offsets and OCR text by page/rectangle;
  render bounded Markdown with source/page/provenance and low-confidence
  markers; and add a loopback browser/API reader. It will not add summarization,
  layout-perfect tables, filename disclosure, provider calls, or publication.
  Existing restricted content stays local. No commit, push, PR, merge, or
  deployment is authorized by this phase request.

- 2026-09-04: T-038 first pass is REWORK. Format validation passed, but
  orchestrator review found the specification invented a two-field native text
  region while the actual validated/indexed contract is
  `text:<offset>,0,<length>`. Its allowlist also omitted the proposed pure
  renderer and README/integration-test paths, and its task split overlapped the
  same service/test files. REWORK 1 must correct these facts, define one
  five-file implementation slice followed by non-overlapping docs/integration,
  and keep browser rendering inert without requiring layout-perfect output.

- 2026-09-04: ACCEPT T-038 after the worker corrected the native region
  grammar and task boundaries, and strong review refined the output contract to
  favor human readability: one document-level source identity, page-level
  provenance, compact low-confidence markers, Markdown indented-code data, and
  an HTML-escaped `<pre>` view. The exact SDD validator and diff check pass.
  T-039 is unblocked.

- 2026-09-04: T-039 first implementation is REWORK. Its four renderer tests
  pass, but no service/API acceptance tests were added. Strong review found
  that scanning the global progress directory rejects valid records belonging
  to other batches, and that recomputing `index_sha256` after sorting by random
  chunk ID does not match the extractor/insertion order used by `run_batch`.
  The source query materializes rows before enforcing its 10,000-row ceiling;
  malformed durable values can escape the stable error map; listing byte
  metadata incorrectly renders every Markdown body; and production code
  imports a private validator. REWORK 1 must begin with real `run_batch`
  service/API regressions and correct these boundaries without expanding scope.

- 2026-09-04: T-039 REWORK 1 is REASSIGN to codex-strong. The retry corrected
  insertion order and added one two-batch service test, but still omitted the
  requested unfinished/corrupt/oversized/HTTP/escaping acceptance matrix. It
  also reads every progress record through unbounded path-based `read_bytes`,
  keys same-manifest progress only by source rather than source plus item path,
  and emits every OCR rectangle in the page provenance line despite the compact
  output contract. Strong completion will add the missing RED tests, use pinned
  bounded service descriptors, validate the index once for a bounded source
  set, and keep page provenance compact.

- 2026-09-04: ACCEPT T-039 after strong RED/GREEN completion. The index now
  opens an existing database without schema creation, validates FTS/rows once,
  and reads up to 100 exact sources in durable row order with a 10,000-chunk
  ceiling. The service resolves processed membership from the requested durable
  result, validates progress through pinned bounded descriptors keyed by
  manifest/source/item path and chunk-set digest, and exposes bounded listing,
  Markdown download, and escaped HTML routes with stable 404/409/413 errors.
  Native offsets and OCR coordinate lines render deterministically with compact
  page provenance and visible sub-0.80 confidence markers. Forty-nine focused
  tests pass on the host with five environment-only skips; the two real FastAPI
  tests plus nine renderer tests pass in the pinned container with no skips.
  T-040 is unblocked.

- 2026-09-03: The orchestrator completed the private ten-document calibration
  pilot with 2 PDFs and 8 PNG screenshots (40,118,553 bytes) under
  `unconfirmed`/`restricted` policy and no provider access. Real execution
  exposed five independent defects: valid blank Tesseract level-5 rows were
  rejected, the container omitted the canonical taxonomy, wide long images did
  not derive a pixel-bounded tile height, extraction and indexing disagreed on
  NFKC normalization, and a 10,000-row item ceiling was incorrectly reused as
  the whole-index ceiling. Each defect received a living
  spec update, RED regression, minimal fix, and focused/full verification. The
  final run processed 10/10 in 247.713 seconds, produced 16,168 searchable cited
  chunks with zero coordinate violations, matched the 37-page native PDF
  exactly after normalization, hit 21/22 sampled scanned-PDF heading phrases,
  and reused an identical resubmission without changing durable evidence. The
  final constrained image revision is `a2705a62e0aae3aeb6ae3b1e7d6b7c07f97701acae570ae71f476e0268244e44`;
  289 tests pass with four explicit environment-only skips. Decision: the
  10-document gate passes, while restricted content remains local and the
  70-PDF/30-image representative benchmark, formal quality thresholds,
  rootless runtime, and production-readiness gates remain open.

- 2026-09-03: ACCEPT T-037 after strong implementation and review. A separate
  code-ceiling-bound config fixes `fallrising/doc_analysis_study`, SSH URL,
  `main`, `studies`, root registry, branch prefix, absolute Git/gh executables,
  timeout, and output limits without changing the T-035 export config. The
  host-only publisher revalidates the T-036 bundle/staging/validator/diff,
  defaults to dry-run, fetches and pins remote main before explicit mutation,
  creates deterministic `study/<slug>-<bundle-prefix>` history, pushes one
  exact non-force branch refspec, requests and verifies a draft PR, and retains
  bounded replay evidence. Fourteen focused tests pass, including a fake bare
  remote, single push/create and idempotent replay, stale base, branch/push/PR
  failures and collisions, strict config, changed/secret/extra paths, timeout,
  and partial/tampered evidence. The 286-test full gate passes. The previously
  validated real target staging checkout passed the production shell dry-run
  with branch `study/ice-maker-runtime-study-4fec13b757c3` and exact six paths;
  no prepared marker or remote action occurred. The actual target checkout
  remained clean. Current `gh auth status` reports an invalid credential, so a
  real publish remains an explicit external operator action after re-login.

- 2026-09-03: T-037 uses a separate strict
  `config/study-github-publication.json` instead of adding fields to
  `config/study-publication.json`. The latter is an exact T-035 export contract;
  extending it would couple Git capability to the parser/export boundary and
  invalidate its fail-closed loader. The new config fixes repository, SSH URL,
  base, path roots, branch prefix, absolute executables, time, and output
  ceilings to code-owned values. The installed `gh` authentication check is
  currently invalid, so only a local fake-bare-remote test is authorized; no
  real GitHub mutation will be attempted.

- 2026-09-03: ACCEPT T-034 after the Codex retry produced no report and the
  Cursor escalation stalled after an incomplete failing test. Strong review
  first reproduced the invalid search call and duplicate-result binding
  failures, then completed one deterministic 100-item service/coordinator
  journey. It generates exactly 70 PDF-shaped and 30 PNG/JPEG/WebP-shaped
  controls, interrupts after item 50, reconstructs state, performs no repeated
  completed extraction, and ends with 97 processed, one content duplicate, one
  policy rejection, and one isolated extraction failure. All 97 successful
  chunks are searchable with source hash and page/text or original-image
  rectangle evidence; status excludes raw bytes, extracted text, and absolute
  paths, while per-item restricted/confidential policy survives. The focused
  test, 281-test full gate, SDD validation, compilation, and diff check pass.
  The runbook now covers doctor/build/start/upload/status/stop/resume,
  writable-state and backup boundaries, a 10-document pilot, and a 100-item
  benchmark. Generated evidence remains explicitly non-quality control
  evidence and does not clear the real-corpus or production sandbox gates.

- 2026-09-03: ACCEPT T-036 after rejecting the two-test PARTIAL worker result.
  Strong rework now recomputes the exact bundle aggregate/tree/artifact hashes,
  requires repository/base/contract/bundle identities, rejects dirty or
  attached bases plus unsafe hooks/config/alternates/replace refs/submodules/
  extra worktrees, and retains the true base commit through an offline Git
  bundle rather than synthesizing unrelated history. Preview emits the exact
  bounded six-path diff; apply validates and atomically publishes a private
  no-replace staging checkout, while idempotent re-entry revalidates artifacts,
  registry, validator, base, paths, and diff. Nine focused tests pass. A real
  native-target preview/apply in `/tmp` passed the target validator with four
  studies and 104 Markdown files at base `ad28e5c`; the owner's actual
  `doc_analysis_study` checkout remained clean and unmodified. T-037 is
  unblocked.

- 2026-09-03: ACCEPT T-033 after rejecting the worker's unverified floating
  Bookworm image and replacing it with the measured Python base digest, Debian
  snapshot, exact apt/Python dependencies, sanitized build context, and
  immutable source label. Real smoke exposed and fixed order-dependent daemon
  security parsing, root-only copied configuration, Docker JSON health-command
  escaping, and non-durable host background relay lifecycle. The final parser
  is healthy with no network, no published ports, one data mount, read-only
  root, dropped capabilities, no-new-privileges, and fixed CPU/memory/PID
  ceilings. A separately constrained Docker-managed relay mounts only the Unix
  socket runtime directory, binds exactly host loopback without Docker port
  publishing, and reuses only exact healthy identities. Six host-permission
  policy tests, a real pinned build, end-to-end health request, container
  inspection, and idempotent second start pass. T-034 is unblocked.

- 2026-09-03: ACCEPT T-032 after rejecting the two-test PARTIAL worker result.
  Strong rework made rights/data-class/languages/size explicit, removed all
  filename-derived storage, streamed and bounded copies, replaced mutable
  rename/path state with descriptor-pinned no-replace publication, and added a
  content-addressed immutable upload record. A durable numbered-attempt log now
  recovers abandoned running work without using in-memory futures as status
  truth; a process lock and tested scheduler enforce two workers. Twelve host
  tests pass with one intentional optional-dependency skip; an isolated pinned
  Python container passes all thirteen including real FastAPI multipart/ASGI
  routes. The full 264-test gate passes. T-033 is unblocked.

- 2026-09-03: ACCEPT T-035 after strong rework replaced the coarse five-test
  export with a hash-bound source/chunk/analysis/QA/decision ledger and exact
  human-approval set. The final boundary emits six native target artifacts,
  keeps raw/extracted text and absolute paths out of output, applies independent
  rights and Public/Internal/Restricted sensitivity gates, denies Prohibited
  publication, reads canonical inputs/config through pinned no-follow
  descriptors, and publishes an exact immutable tree with atomic no-replace
  collision handling and targeted cleanup. Thirteen focused and 201 branch
  tests pass. The real `doc_analysis_study` checkout remained unmodified; T-036
  owns isolated application and target-native validation.

- 2026-09-03: T-035 first implementation is PARTIAL and rejected. Its five
  tests do not cover the specified adversarial matrix; public output includes
  the absolute bundle path; the registry row has the wrong column count;
  `sources.md`, progress, and QA omit native required sections; CLI/config and
  idempotent reads follow path-based race-prone operations; and the evidence
  ledger binds only coarse source hashes rather than selected extraction chunks
  and provenance. Strong rework must emit only a relative content identity,
  validate a hash-bound chunk/source/analysis/QA/approval ledger, render the
  actual target contract, and publish/read the fixed tree through pinned
  no-follow descriptors.

- 2026-09-03: ACCEPT T-031 after strong escalation replaced the partial
  coordinator with an ordinary CLI path backed by a frozen explicit Poppler /
  Tesseract toolchain and one pinned per-item discovery pass. Extraction cache
  keys bind source, configuration, tool identity, languages, rights, and data
  class; completion progress additionally binds the validated cache and index
  chunk set and is published only after idempotent FTS insertion. Regressions
  cover isolated corrupt sources, duplicate/denied suppression, short reads and
  source mutation, cache/progress forgery and links, changed extractor binding,
  interruption without repeated OCR, exact OCR word rectangles, text chunk
  offsets, Traditional Chinese FTS5, Unicode/coordinate/secret bounds, CLI exit
  behavior, and absence of provider/network/Git imports. Forty-four focused and
  238 full repository tests pass. Real container tools and corpus quality remain
  external gates; T-032 and T-035 are unblocked.

- 2026-09-03: T-031 first implementation is rejected. It added no new tests,
  and `knowledge batch` deterministically fails every ordinary item because its
  default extractor is an intentional error. Review also found a single
  potentially short source read, no post-read identity check, source-SHA-only
  cache keys, permissive/path-following cache loads, checkpoints published
  before indexing, lost per-word OCR rectangles, message-derived reason codes,
  `BaseException` swallowing, and a global weakening of canonical JSON. The
  index accepts rectangles extending beyond the declared bound. REWORK 1 is
  reassigned to Codex Terra and must begin with persisted adversarial tests,
  wire the real local extractor through an explicit toolchain, and bind durable
  progress to source/config/tool/language/policy evidence.

- 2026-09-03: ACCEPT T-030 after REWORK 1 corrected the actual
  `pdftoppm -singlefile -png <input> <output-prefix>` file contract, added
  page-level all-native/all-scanned/mixed and failure regressions, and bound
  every chunk to normalized text plus native/OCR evidence and rendered-page
  identity. Strong escalation added a RED regression for ordinary UTF-8 PDF
  metadata and replaced path-based raster reads with a bounded `O_NOFOLLOW`
  descriptor read whose inode, link count, size, and modification identity are
  checked before publication. Fifteen focused, 38 compatibility, and 227 full
  repository tests pass. Real pinned-container Poppler/Tesseract behavior and
  corpus accuracy remain external gates; T-031 is unblocked.

- 2026-09-03: T-030 first implementation is rejected despite 11 focused tests.
  Only two tests exercise PDFs. The implementation expects `pdftoppm` PNG on
  stdout even though the selected tool writes an output-prefix file, and an
  independent probe constructed two different accepted page texts with the
  same chunk ID because content/regions are not bound. It also drops rendered-
  page hash/dimensions, silently accepts unknown `pdfinfo` fields, and lacks the
  specified all-native/all-scanned/blank, per-page failure, output-bound,
  timeout, cache-forgery, direct-construction, and cleanup regressions. REWORK 1
  must mirror real Poppler file behavior and seal complete page evidence before
  batch integration.

- 2026-09-03: ACCEPT T-029 after REWORK 1 supplied one source-bound
  decode/tile/Tesseract/TSV/result operation and upgraded Pillow to the reviewed
  12.3.0 pin. Strong review added failing regressions for directly forged
  result evidence, incomplete tile coverage, aggregate multibyte output,
  tracked maximum image dimension, deterministic sequential execution, and
  real subprocess output/timeout cleanup. The final adapter keeps raster data
  private, applies an RLIMIT plus live output checks, remains below the two-
  worker ceiling, and publishes only immutable original-coordinate evidence.
  Nine focused, 32 related, and 221 repository tests pass. Real Pillow and
  Tesseract quality remain container/corpus gates; T-030 is unblocked.

- 2026-09-03: T-029 first implementation is rejected despite six passing
  tests. It exposes unvalidated `DecodedImage`/`OcrWord`/`RasterExtraction`
  constructors (including a raw raster field), case-folds words before
  deduplication instead of requiring exact normalized text, does not compose
  decode/crop/OCR/parse/result, and has no concurrency or hard running-output
  bound. It also cannot prove signature-versus-codec agreement, requested
  language availability, complete TSV structure, subprocess-group cleanup, or
  source revalidation, and pins stale Pillow 10.4.0 rather than the reviewed
  release. REWORK 1 restores the original adversarial matrix and one public
  end-to-end raster API before any PDF work begins.

- 2026-09-03: ACCEPT T-028 after orchestrator review added five failing
  regressions beyond the Terra reassignment: an intermediate-directory swap,
  directly forged source evidence, unbounded/ill-typed public values, swallowed
  directory-sync failure, and checkpoint publication through a swapped parent.
  The final boundary pins input/checkpoint directories and descendant opens,
  streams source hashing in 64 KiB chunks, rejects hard-link aliases, validates
  exact bounded immutable results and duplicate bindings, and publishes durable
  no-replace checkpoints. Sixteen focused, 24 Phase-8 foundation, and 212 full
  repository tests pass.

- 2026-09-03: T-028 REWORK 1 expanded the suite from three to nine tests and
  fixed several schema defects, but did not satisfy its security contract.
  Review found that discovery still buffers each complete 256 MiB source rather
  than streaming it; a single manifest hard link is accepted; result
  serialization remains unbounded; checkpoint paths accept relative/traversal
  inputs; and required aggregate, oversized, non-regular, root/intermediate
  symlink, checkpoint no-replace/symlink/partial/schema, and full config-bound
  regressions are absent. Per the worker escalation rule, T-028 is reassigned
  to Codex Terra rather than accepted on the nine passing tests.

- 2026-09-03: Downstream review found the Phase-4 `KnowledgeIndex` rejects
  non-ASCII text, production OCR methods, and pixel coordinates above three
  digits. Without a surgical compatibility extension, Traditional Chinese and
  long screenshots could be extracted but never indexed. T-031 now owns
  bounded normalized Unicode, production provenance/coordinate validation, and
  legacy-regression coverage.
- 2026-09-03: T-028 first implementation was rejected. Although its three
  aggregate tests passed, review reproduced a substantial evidence gap and
  found that duplicate content was not represented, failed/rejected items could
  transition to success, results/checkpoints accepted malformed fields, reads
  lacked complete identity/short-read proof, configured `max_items` was ignored,
  and tile overlap was compared to an area. REWORK 1 requires the originally
  specified adversarial matrix and exact immutable contracts.
- 2026-09-03: A study bundle is one coherent historical-system analysis, not a
  synonym for one upload batch. Each export explicitly selects source IDs and
  supplies the stable slug/title/sensitivity/cutoff; one 100-file batch may
  produce several independently reviewed bundles. This preserves focused QA,
  publication approval, and resumability while reusing local content hashes.
- 2026-09-03: ACCEPT T-027 after orchestrator re-ran shell syntax, all eight
  focused regressions, diff hygiene, and the integrated real-host probe. The
  probe exits 1 as `host-capable`: Linux/x86-64, 6 CPUs, about 16 GiB available
  RAM, about 147 GiB free disk, Docker cgroup v2/seccomp/AppArmor available, no
  GPU, and host Poppler/Tesseract/service Python packages absent. This validates
  the container route without claiming installed-runtime readiness.
- 2026-09-03: T-027 first implementation was rejected despite four passing
  fixture tests. A real execution rendered `/proc/meminfo` bytes in scientific
  notation and therefore classified available RAM as unknown; it also treated
  Docker client stdout from a failed daemon query as daemon reachability and
  copied one aggregate security result into three evidence fields. REWORK 1
  requires real-format regressions, independent cgroup/seccomp/AppArmor
  evidence, and explicit `eng,chi_tra` language requirements.
- 2026-09-03: Owner selected `doc_analysis_study` as the durable home for
  approved historical-system analysis and requested both local preservation and
  GitHub upload. Its existing contract already separates raw source material
  from publishable analysis and requires study metadata, source inventory,
  evidence levels, QA, and publication approval. Decision: Ice Maker emits an
  immutable native study bundle locally; a separate host-side publisher applies
  only approved Markdown/metadata to an isolated target checkout, validates it,
  and defaults to a diff. GitHub capability is an explicit allowlisted branch +
  draft-PR action with no direct main/merge/deploy authority. The current dirty
  `doc_analysis_study` checkout is never a publication target.
- 2026-09-03: Owner expanded SDD-0008 to include a repeatable host doctor,
  scripted infrastructure, and a startable local multi-file upload service. The
  measured host is Debian 12 x86-64 with 6 vCPU, 25 GiB RAM (16 GiB available),
  147 GiB free ext4 storage, no GPU, Python 3.11 without pip, and no host
  Poppler/Tesseract/ImageMagick. Docker 27.5.1 is reachable and reports cgroup v2,
  seccomp, and AppArmor. Decision: use a containerized local Poppler + Tesseract
  + Pillow + FastAPI stack, default to two OCR workers and loopback binding, and
  treat 4 CPU/8 GiB available RAM/20 GiB free disk as the conservative capacity
  floor. Installed-runtime benchmark and real-corpus accuracy remain evidence
  gates rather than guessed throughput claims.
- 2026-09-03: SDD-0008 documents the requested production ingestion gap before
  implementation. The intended local-only slice covers a manifest-declared
  70-PDF/30-image batch, native and OCR PDF pages, tiled long screenshots,
  provenance, deterministic resume, bounded reporting, and existing FTS5
  integration. The current host has none of Poppler, Tesseract, or ImageMagick.
  Proposed production dependencies were Poppler, Tesseract language data, and
  allowlisted Pillow codecs. The owner subsequently authorized scripted local
  infrastructure and a startable upload service; corpus language/limit/data-
  class confirmation remains a pilot input. No real-document capability was
  claimed at this documentation-only checkpoint.
- 2026-09-03: Post-build status reconciliation confirmed repository owner
  `fallrising` merged PR #1 into `main` as `ed3da350`. The merge commit tree is
  identical to final integration head `2308d65`; CI passed on both that head and
  the `main` merge commit. This updates repository disposition only. Overall
  status remains `DEVELOPMENT_COMPLETE`, branch protection is still unavailable
  on the current private-repository plan, and all production attestations remain
  external-pending.
- 2026-09-03: Final gate ran from detached clean checkout `d9a53bf`: repository
  policy and 188 tests, hardening/publication E2E, byte compilation, immutable
  source hashes, package sdist/wheel build, diff, and clean status all passed.
  Overall local status is `DEVELOPMENT_COMPLETE`; real infrastructure evidence
  still prevents any `PRODUCTION_READY` claim.
- 2026-09-03: T-026's first green journey observed corrupt, over-cost, and
  threshold failures but then created unrelated complete passed evidence, so it
  did not prove failure-to-evidence gating. REWORK made evidence emission follow
  each successful control and bound validated results into artifact digests.
  After three failed runbook patch attempts, strong escalation completed the
  exact commands and report. One focused journey and 188 total tests pass;
  decision: ACCEPT. Phase 7 is locally complete with all eight production gates
  still external-pending.
- 2026-09-03: T-025 REWORK replaced path prechecks with pinned no-follow
  descriptors, made restore publication atomic no-replace, preserved a racing
  destination, and required immutable drill inputs. Strong review then sealed
  every public contract/result constructor and added direct-construction
  regressions. Nineteen focused and 179 total tests pass; decision: ACCEPT.
- 2026-09-03: T-025's first pass reported PARTIAL because Claude could not run
  Python/Make; orchestrator execution passed its 13 focused tests. Independent
  probes then allowed a directly forged default-allow policy, accepted mutable
  drill inputs, and replaced a destination created at the final restore race.
  Decision: REWORK with sealed values, exact tuples, pinned no-follow source and
  destination descriptors, and atomic no-replace directory publication.
- 2026-09-03: T-024 REWORK fixed directional quotas, sealed evidence, unsafe
  labels, and external gate coverage. Strong review then reproduced ancestor-
  symlink config reads and directly constructible empty/invalid metric values;
  descriptor-relative no-follow reads and complete public invariants now reject
  both. Eight focused and 168 total tests pass; decision: ACCEPT.
- 2026-09-03: T-024's first pass passed 164 tests, but independent probes
  treated zero success/test/cache/OCR rates as healthy, accepted unsafe labels
  behind an unrelated incomplete-snapshot failure, and let directly forged
  non-SHA evidence produce `DEVELOPMENT_COMPLETE`. Its external gate set was
  also incomplete. Decision: REWORK with directional thresholds, sealed values,
  isolated regressions, bounded no-follow config reads, and exact gate coverage.
- 2026-09-03: Phase 6 checkpoint `9d0127a` was pushed over SSH; remote SHA
  matched and draft PR #1 remained open/draft. Phase 7 separates observability
  and evidence semantics from hardening/drill primitives, then composes both in
  a dependent local journey. No protected path or real infrastructure is in
  scope; the final status ceiling remains `DEVELOPMENT_COMPLETE`.
- 2026-09-03: T-023 REWORK deletes only `.ice-maker/publications` and proves
  unrelated state survives success and fail-closed paths. Strong review changed
  the fixed sentinel to an exclusively created unique file so the test cannot
  overwrite an existing runtime artifact. Two focused and 160 total tests pass;
  decision: ACCEPT. Rights, signing identity, and public publishing stay
  external-pending.
- 2026-09-03: T-023's first pass passed 160 tests and correctly proved the
  shared synthetic source and two-book byte identity, but its setup, rebuild,
  and cleanup recursively deleted the entire `.ice-maker` runtime-state root.
  Decision: REWORK with a publications-only deletion boundary and an unrelated
  sentinel survival regression.
- 2026-09-03: T-022 strong escalation pins one repository descriptor across
  all reads and descriptor-relative output creation, rejects non-canonical
  paths and root swaps, publishes one complete book directory with exclusive
  atomic rename, and emits silent JSON CLI failures. Eight focused, 158 total,
  diff checks, and independent confinement/atomicity/marker probes pass.
  Decision: ACCEPT; T-023 is unblocked.
- 2026-09-03: T-022 REWORK changed publication to an atomic directory and
  closed the first four probes, but a second review swapped the repository
  directory between manifest and chapter reads and produced a mixed snapshot.
  A deterministic output-creation race also created directories outside the
  repository before failing, while non-canonical `//` and internal `..` paths
  were accepted. Per policy, REWORK failed; ESCALATE to `codex-strong` for one
  pinned repository descriptor and descriptor-relative directory creation.
- 2026-09-03: T-022's first pass passed 153 tests, but independent probes
  accepted a repository reached through an ancestor symlink, published into a
  source directory, exposed Markdown before HTML during two-link publication,
  and let argparse echo an untrusted value. Decision: REWORK with a repository-
  confined `.ice-maker` output, descriptor/no-follow roots, one atomic
  no-replace directory publication, and stable non-echoing parse errors.
- 2026-09-03: T-021 rework removed the manifest/commit self-reference,
  validates every public immutable value, requires exact bounded tuple input,
  and rejects citation drift across the whole book. Seven focused, 150 total,
  diff checks, and five independent forgery/type/drift probes pass. Decision:
  ACCEPT; T-022 is unblocked.
- 2026-09-03: T-021's first pass passed 147 tests, but independent probes
  rendered a directly forged invalid source commit and accepted one chunk ID
  bound to two source hashes across chapters. Embedding a source commit in a
  tracked manifest also creates an unsatisfiable self-reference. Decision:
  REWORK with a separate build-time commit argument, sealed value invariants,
  immutable bounded inputs, and book-wide citation consistency.
- 2026-09-03: Phase 5 checkpoint `18e4596` was pushed over SSH; remote SHA
  matched and draft PR #1 remained open/draft. Phase 6 is split into a pure
  compiler, a dependent confined filesystem boundary, and a final two-book
  rebuild journey. Markdown/HTML and tracked synthetic JSON sources avoid new
  dependencies; rights review and any public publisher remain external gates.
- 2026-09-03: T-020 rework made composition tuple-only and integrity
  fail-closed, validates the complete synthetic journey against its source
  experiences, and preflights both promotion transitions before consuming the
  retained ledger. Six focused and 143 full tests, independent retry/bypass
  probes, diff checks, and source hashes pass. Decision: ACCEPT. Phase 5 remains
  external-pending for real corpus rights, production identities, and durable
  approval/audit services.
- 2026-09-03: T-020's first pass passed 141 tests, but an independent two-call
  probe showed that a rejected pattern gate consumed valid knowledge decisions,
  making a corrected retry fail as replay. Review also found an explicit
  integrity bypass, mutable iterable input, and a forgeable public journey.
  Decision: REWORK once in the same task with atomic preflight and complete
  cross-field validation.
- 2026-09-03: T-019 strong escalation added slotted frozen artifacts and review
  records; the stale-digest mutation probe now reports no mutable `__dict__`.
  Ten focused and 131 full tests pass. Decision: ACCEPT.
- 2026-09-03: T-018 rework now rejects non-SHA and mutable provenance,
  truthfully reports duplicate/orphan evidence, recognizes normalized negation,
  and fails closed at the report cardinality bound. Six focused and 127 full
  tests plus independent SHA/cardinality probes pass. Decision: ACCEPT.
- 2026-09-03: T-019 rework closed its citation and stateless replay findings,
  but an independent probe mutated the frozen artifact through `__dict__`
  without updating its digest. Decision: REWORK failed; ESCALATE to
  `codex-strong` for slotted immutable review values and regression coverage.
- 2026-09-03: T-018 and T-019 first passes were locally green, but orchestrator
  review found non-SHA chunk references, mutable value inputs, incomplete or
  misleading integrity evidence, and a stateless promotion API that bypassed
  replay protection. Decision: REWORK both foundations with named regressions.
- 2026-09-03: Phase 5 is decomposed into independent retrieval/integrity and
  promotion-gate foundations, followed by one synthesis E2E slice. All
  production-experience inputs are conspicuously synthetic; they prove control
  behavior only and are not accepted as real operational evidence.
- 2026-09-03: T-017's first pass passed three E2E and 119 total tests, but three
  independent subprocess probes bypassed the extract stage, cited manifest B
  from manifest A's proposal, and promoted a forged restricted-manifest policy.
  Ad hoc state reads/writes also bypassed the established no-follow boundary.
  Decision: REWORK with immutable digest-bound stage evidence, isolated index
  provenance, full content-derived manifest revalidation, and symlink tests.
- 2026-09-03: T-017 rework made every independent bypass probe fail closed,
  added digest-bound stage evidence and per-index retrieval isolation, and
  passed five focused plus 121 full tests. The orchestrator reformatted the
  worker implementation for maintainability without changing behavior and
  repeated the focused, probe, compile, diff, and full gates. Decision: ACCEPT.

- 2026-09-02: Preflight confirmed the target was absent, GitHub login was
  `fallrising`, and `fallrising/ice-maker` did not exist before bootstrap.
- 2026-09-02: Use Python 3.11 standard library, SQLite WAL, local filesystem,
  synthetic fixtures, and Markdown/HTML. Production infrastructure stays behind
  explicit adapters and external evidence gates.
- 2026-09-02: Codex, Claude, Cursor, Grok, and the pinned OpenCode 1.18.9 binary
  passed model/auth/non-interactive smoke checks. OpenCode is not on `PATH`, so
  dispatch uses `/tmp/phark-opencode-v1.18.9/opencode`.
- 2026-09-02: Tesseract, Poppler, and Node are absent. Phase 4 must use a
  dependency-free synthetic OCR fixture engine and keep production OCR as an
  explicit external adapter boundary.
- 2026-09-02: No VPS, production object-store credential, or production model
  credential is read or assumed. Those gates cannot exceed external-pending.
- 2026-09-02: The OpenCode T-001 dispatch was rejected by the execution safety
  layer because private repository/SDD input was not explicitly authorized for
  that third-party destination. No worker process or change remained. T-001 and
  T-002 were reassigned to isolated Codex Luna workers; provider policy must be
  established before any external-provider repository review.
- 2026-09-02: T-001, T-002, and T-003 diffs were independently reviewed and
  their focused commands rerun successfully. T-002 required one report-format
  rework and then report-only escalation to Codex Terra; implementation did not
  change during that escalation. Decisions: ACCEPT all three.
- 2026-09-02: GitHub branch-protection API returned HTTP 403 because this private
  personal repository requires a GitHub Pro upgrade. Visibility remains private;
  the enforceable remote branch gate is external-pending. Local CODEOWNERS and
  policy controls remain required but are not misrepresented as server enforcement.
- 2026-09-02: T-004 initially allowed a production file to bypass secret scanning
  by carrying a synthetic marker. The worker fixed the path boundary, added a
  regression test, and strengthened duplicate CODEOWNERS validation. The
  orchestrator reran all seven tests and `make check`; decision: ACCEPT.
- 2026-09-02: Phase 0 local controls pass. Remote branch protection and production
  infrastructure remain explicit external evidence gates, so the phase status is
  `CODE_COMPLETE_EXTERNAL_PENDING` and independent local Phase 1 work may proceed.
- 2026-09-03: The GitHub credential had not expired; it retained `repo` scope but
  lacked OAuth `workflow` scope. Existing account-authorized SSH authentication
  succeeded, so repository Git transport moved to SSH while `gh` remains the PR/API
  client. Phase 0 remote SHA now exactly matches local `b3b90f9`.
- 2026-09-03: T-005 required one Luna rework for missing User stories and weak
  task-ID validation. A post-rework probe still accepted `src//escape`, so the
  task was reassigned to Terra per policy. Terra added a failing regression and
  minimal fix; the orchestrator reran 17 tests and accepted the task.
- 2026-09-03: T-006 main lifecycle tests passed, but orchestrator review found
  that `init` could follow a symlinked `specs/templates` directory outside the
  repository and `new` left the front-matter title placeholder unchanged.
  Decision: REWORK with explicit no-partial-write and generated-content tests.
- 2026-09-03: T-006 Luna rework fixed all four requested regressions and passed
  16 tests. Final review found the original atomic no-overwrite contract still
  vulnerable because `os.rename` may replace a target created after preflight.
  Per escalation policy, decision: REASSIGN to Terra for a Linux no-replace
  publication primitive and race regression.
- 2026-09-03: Terra added and proved a collision regression, replaced the unsafe
  publish call with Linux `renameat2(RENAME_NOREPLACE)` via the standard library,
  and made unsupported runtimes fail closed. The orchestrator reran 17 tests,
  checked the complete diff/report, and accepted T-006.
- 2026-09-03: T-007 wired active validation into `make check` and passed 30
  tests, but review found the shared validator still followed symlinked governed
  files. Decision: REWORK so both CLI and CI reject the file boundary before read.
- 2026-09-03: T-007 rework added five symlink boundary cases in the shared
  validator. The orchestrator reran focused tests plus `make check`; all 32 tests
  passed. Decision: ACCEPT. Phase 1 has no external dependency and is `PASS`.
- 2026-09-03: Phase 1 checkpoint `2588fe6` was pushed over SSH; remote SHA and
  draft PR #1 head matched exactly. Phase 2 is split at the security boundary:
  Claude owns contract/process/path enforcement, then Cursor owns runner/adapter,
  then Codex Luna owns gated publication evidence.
- 2026-09-03: The first T-008 Claude fable/high dispatch produced no output,
  report, or workspace change for about five minutes and ended with `Execution
  error` when interrupted. This is recorded as a worker transport stall, not an
  implementation attempt. Retry uses the protocol's Claude xhigh escalation in
  the same clean worktree and unchanged scope.
- 2026-09-03: Claude fable/xhigh repeated the same five-minute no-output,
  no-change stall and returned `Execution error` on interruption. With the clean
  worktree confirmed, T-008 is REASSIGNED unchanged to Codex Terra; no Claude
  implementation or review was accepted.
- 2026-09-03: T-008 Terra produced a seven-test first implementation, but
  orchestrator review found the malformed-contract loop was masked by a fake
  base SHA, raw output was truncated before redaction, the code diverged from
  `task.schema.json`, and an ancestor base was treated as current. Decision:
  REWORK with focused boundary, child-cleanup, and rename regressions.
- 2026-09-03: T-008 REWORK 1 passed 11 tests, but orchestrator review reproduced
  a chunked-secret leak across the byte cap and wildcard overlap with a protected
  subtree. Per escalation policy, `codex-strong` added a second RED set and fixed
  bounded look-ahead/redact-then-truncate behavior, incomplete-key redaction,
  safe start errors, spec cost ceilings, command validation, and conservative
  protected-prefix intersection. All 16 tests and compile/diff checks passed;
  decision: ACCEPT.
- 2026-09-03: The previously valid GitHub CLI OAuth token later became invalid
  in under one day; GitHub does not expose the revocation cause locally. SSH still
  authenticates as `fallrising` and remains the Git fetch/push transport. PR/API
  mutations require one new interactive authorization; no token is placed in the
  repository, task prompt, logs, or command arguments.
- 2026-09-03: T-009 Cursor Grok high ran for over five minutes with no output,
  report, or worktree change and was interrupted with exit 130. This is recorded
  as a provider transport stall. The unchanged task retries once with the table's
  `cursor-grok-4.6-xhigh` escalation in the same confirmed-clean worktree.
- 2026-09-03: T-009 Cursor Grok xhigh also ran for over five minutes with a
  valid login and installed model ID but produced no output, report, or code;
  it was interrupted with exit 130. Two clean transport stalls make further
  Cursor retries low-value, so the unchanged task is REASSIGNED to Codex Terra
  medium. No Cursor result is accepted.
- 2026-09-03: T-009 Terra's first four-test implementation passed its focused
  command, but orchestrator review found cleanup failure became non-retryable,
  global worktree prune was used, output could escape the worktree, `/bin/echo`
  passed doctor, `/` could be mounted, sandbox policy was mostly unenforced,
  and secret-bearing environment values were accepted. Decision: REWORK with
  named RED cases; none are external-infrastructure gaps.
- 2026-09-03: T-009 Terra REWORK passed eight tests, but it did not exercise
  failed-cleanup retry or partial-add registration, its doctor rejected the
  installed `codex-cli 0.152.1` format, symlink identity was discarded before
  validation, path-confused image names remained valid, and sandbox construction
  did not consume the policy. Per escalation policy, T-009 moves to
  `codex-strong` for a second RED set.
- 2026-09-03: T-009 strong escalation added cleanup-failure retry,
  partial-registration cleanup, installed `codex-cli` doctor format,
  symlink/output containment, path-confused image rejection, mandatory strict
  policy consumption, and success-result evidence. All 11 focused tests plus
  compile and diff checks passed; decision: ACCEPT. The repository secret gate
  also identified four synthetic T-008 fixtures lacking the existing marker;
  the orchestrator marked only those fixture lines without weakening scanning.
- 2026-09-03: T-010's first pass correctly stopped on its CODEOWNERS scope
  boundary, but orchestrator review also found claimed-path and boolean-cleanup
  inputs could stand in for actual Git/worktree evidence, cost was not bounded
  by the task contract, and a directly constructed publication request could
  bypass validation. Decision: REWORK with real temporary-Git evidence and the
  master-prompt-authorized synchronized CODEOWNERS update.
- 2026-09-03: T-010 Luna REWORK passed five focused and 64 total tests, but an
  orchestrator probe returned publishable evidence for a never-created absent
  path even when `cleanup_succeeded=False`; another rejected valid multiline
  command output, and malformed adapter evidence escaped as `AttributeError`.
  The diff was read from the source repository after an unrelated worktree was
  cleaned. Per escalation policy, decision: REASSIGN to Terra for an explicit
  active-stage/cleanup/finalize evidence state machine.
- 2026-09-03: T-010 Terra replaced the forgeable cleanup claim with staged
  evidence bound to the exact active registered worktree and finalization after
  that same job is absent and unregistered. It also canonicalized the complete
  evidence digest, validates malformed command evidence before field access,
  accepts ordinary multiline output, and keeps draft publication fail-closed.
  The orchestrator reviewed the full diff, added a C0/C1-control regression,
  and reran eight focused and 67 total tests; decision: ACCEPT. Real runner,
  rootless/egress, provider, and scoped
  publisher evidence remain external-pending.
- 2026-09-03: Phase 3 is split into two non-overlapping parallel foundations:
  concrete adapter boundaries (T-011) and pure routing/usage policy (T-012).
  Their accepted APIs feed the dependent sequential pipeline (T-013). All
  provider executions use local fake CLIs; live credentials and paid calls stay
  external-pending.
- 2026-09-03: T-011's fake tests encoded nonexistent output/input flags and
  rejected the actual installed OpenCode, Claude, and Grok version strings;
  T-012 omitted the OpenCode and reviewer routes and under-validated usage and
  policy state. Both first passes are REWORK. Actual CLI help/version probes
  were captured read-only; no provider prompt was sent.
- 2026-09-03: T-011 REWORK matched all three installed CLI version/argument
  shapes, but omitted required race/failure/truncation output cases and exposed
  its destination name before the write completed. Per escalation policy,
  `codex-strong` added private-temp plus atomic no-replace publication, strict
  single-line doctor evidence, and the missing regressions. Five adapter, eleven
  Phase 2 runner, and 72 total tests passed; actual local doctor/parser probes
  also passed without a provider call. Decision: ACCEPT.
- 2026-09-03: T-012 REWORK added all four alias-only routes, explicit same-tier
  builder/reviewer fallbacks, frozen policy validation, strict runtime state,
  configuration-bound usage identity, finite costs, and repeat limits. The
  orchestrator reviewed the complete diff and reran eight focused and 75 total
  tests. Decision: ACCEPT.
- 2026-09-03: T-013's first pass exposed arbitrary non-shell argv and accepted
  an unrelated caller ledger plus raw reviewer strings. REWORK sealed all three
  callbacks behind typed evidence boundaries and made the request own its
  ledger. Final strong review corrected route-cost drift against committed
  configuration and rejected no-output sentinels, redacted commands, invalid
  Unicode, and duplicate-key review JSON. Five focused and 85 total tests
  passed; decision: ACCEPT. Phase 3 is `CODE_COMPLETE_EXTERNAL_PENDING` because
  live provider/auth/rate-limit/cost/read-only enforcement was not invoked.
- 2026-09-03: Phase 3 checkpoint `91237ec` was pushed over SSH; remote SHA
  matched and draft PR #1 remained open/draft. Phase 4 uses standard-library
  synthetic text PDF/PBM OCR because Tesseract/Poppler are absent. Runtime
  corpus/index state stays under ignored `.ice-maker/`; tracked fixtures are
  generated during tests, and production PDF/OCR/object-store evidence remains
  external-pending.
- 2026-09-03: T-015 REWORK rejects cache ancestor/entry symlinks, duplicate or
  forged schemas, invalid provenance, and mismatched no-replace collisions. The
  orchestrator reviewed the full diff and reran seven focused and 92 total
  tests; decision: ACCEPT.
- 2026-09-03: T-014 REWORK passed its ten written tests, but an independent
  probe rewrote a canonical manifest for secret-bearing PDF bytes as a clean,
  provider-eligible PBM and duplicate intake accepted it. Decision: REASSIGN to
  Codex Terra to rederive every content-bound policy field from immutable bytes.
- 2026-09-03: T-014 Terra reads source, manifest, quarantine object, and taxonomy
  through stable no-follow descriptors and rederives MIME, hash, findings, and
  eligibility from bytes. The orchestrator reran the original exploit plus 12
  focused and 97 total tests; all passed. Decision: ACCEPT.
- 2026-09-03: T-016's first pass trusted database symlink and mutable taxonomy
  state and returned malformed persisted rows; decision: REWORK. Luna's rework
  addressed those probes, but removed its failing FTS-corruption assertion and
  claimed validation that an independent FTS5 `delete-all` probe disproved:
  search silently returned no result while content rows remained. Per the
  escalation policy, decision: REASSIGN to Codex Terra for authoritative FTS5
  integrity checks and complete input/initialization failure coverage.
- 2026-09-03: T-016 Terra added the authoritative FTS5 external-content
  `integrity-check` comparison mode, explicit transactional schema creation,
  complete initialization cleanup, bounded non-iterable handling, and distinct
  row/index corruption regressions. The orchestrator reviewed the full diff,
  reran 12 focused and 116 total tests, and reproduced that `delete-all` is now
  rejected before a result is returned; decision: ACCEPT.

## Integration policy

The orchestrator reviews every task diff and report, reruns its verification,
records `ACCEPT`, `REWORK`, or `REASSIGN`, and only then integrates the task.
Each phase receives a repository-wide gate, a `phase(N): ...` commit, a push with
remote SHA confirmation, and an update to the same pull request.
