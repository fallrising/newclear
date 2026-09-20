# Local OCR Services Repository

## Current delivery objective

Evaluate the current local host as the target server, validate RapidOCR and Tesseract
with exact-image runtime evidence, gate Paddle Structure on safe spare capacity, and
prepare an evidence-backed production decision without starting production. Persist each
accepted milestone to a human-approved GitHub repository after its owner, repository,
and visibility are specified.

The living verification specification is
`docs/specs/target-server-verification.md`. Earlier repository implementation remains
accepted unless current evidence disproves it.

## Current milestones

- M1 — S-001 target inventory and S-002 compatibility/capacity decisions — COMPLETE;
  private GitHub baseline persisted
- M2 — S-004 through S-007 RapidOCR exact-image verification — COMPLETE; private
  GitHub evidence persisted
- M3 — S-008 and S-009 Tesseract exact-image verification — COMPLETE; private GitHub
  closure persisted at `c9f614d222d2d99fcbb8a4d5e3d154700390fc67`
- M4 — S-010, S-011, and applicable S-016 load/quality evidence — PAUSED at the
  T-006 tooling checkpoint; no M4 runtime load has started
- M5 — S-012 Paddle gate; S-013 through S-015 conditional validation — PENDING M4
- M6 — S-016 through S-019 operations and promotion decision — PENDING PRIOR GATES
- M7 — S-020 production deployment — BLOCKED; explicit human authorization required

## Current dependencies and authorization

- Selected target: current local host — AUTHORIZED.
- Docker inventory and disposable validation containers — AUTHORIZED.
- RapidOCR/Tesseract build or import and non-production runtime verification —
  AUTHORIZED, but reuse exact existing images where rebuilding adds no evidence.
- Paddle build/runtime resource use — NOT YET AUTHORIZED; requires S-012 `GO` first.
- Safe representative fixtures, QPS/concurrency, and latency targets — NOT PROVIDED.
- GitHub milestone persistence — ESTABLISHED at private repository
  `fallrising/local-ocr-services`; `origin/main` is the milestone record.
- Production stack, DNS, TLS, reverse proxy, firewall, release, and public exposure —
  BLOCKED.

## Current verification gates

- Every server claim includes the exact command, exit code, timestamp, and sufficient
  output to assess it.
- Historical evidence, current target evidence, failures, skips, and inferences remain
  visibly separate.
- Each engine receives an evidence-backed promotion status; Paddle cannot inherit status
  from static checks or adapter unit tests.
- The orchestrator runs repository checks, reviews the diff, and applies the evidence
  gate before accepting a milestone.
- GitHub persistence is required at milestone close once the destination is approved.

## Current execution constraints

- Initial commit `c5a495b2f4f8ce5904fe13d6ea3c360c91fbc0bc` now exists on
  `origin/main`, so later bounded editing workers may use separate worktrees. The
  orchestrator continues to own PLAN, review, verification, and acceptance decisions.
- S-003 requires no host-to-host transfer because the repository and existing images are
  already on the selected target. GitHub persistence does not publish container images.
- Existing images have local Docker image IDs and empty `RepoDigests`; do not relabel
  those IDs as registry manifest digests.

## Target-server task registry

The original S-001 through S-020 requirements remain authoritative. This registry tracks
execution order and evidence state without weakening their acceptance criteria.

| ID | Deliverable | Status | Depends on / gate |
| --- | --- | --- | --- |
| S-001 | Target host inventory | DONE | M1 evidence accepted and pushed |
| S-002 | Per-engine compatibility and capacity | DONE | RapidOCR/Tesseract `CONDITIONAL`; Paddle preliminary `NO-GO` |
| S-003 | Artifact transfer decision | DONE | Same host; no host-to-host transfer; private GitHub stores source history only |
| S-004 | Freeze verification baseline | DONE | Commit, checksums, image, redacted credential-handling evidence, synthetic fixtures, benchmark/resource method recorded |
| S-005 | RapidOCR build/import identity | DONE | Exact rebuilt image `2a80e84...663409`; source, dependencies, entrypoint, model manifest, archive, build/resource evidence recorded |
| S-006 | RapidOCR security and HTTP smoke | DONE | Exact image passed runtime security, health, auth, schema, and redacted real OCR checks |
| S-007 | RapidOCR real `--network none` smoke | DONE | Exact image passed real warmup and same-network-namespace loopback HTTP OCR with only `lo` visible |
| S-008 | Tesseract build/import identity and language data | DONE | Exact rebuilt image `25b27d1...a9aec77`; source/dependencies/manifest, engine 5.5.0, languages, archive, and build/resource evidence recorded |
| S-009 | Tesseract security, function, and offline smoke | DONE | Exact image passed hardened online and `--network none` real warmup/same-namespace HTTP checks |
| S-010 | RapidOCR/Tesseract resource and latency measurements | PENDING | M4 protocol is committed; T-006 tooling is not yet accepted and no load was run |
| S-011 | Concurrency and saturation tests | PENDING | S-010; one Uvicorn worker remains fixed |
| S-012 | Final Paddle GO/NO-GO after lightweight-engine measurements | PENDING | S-010/S-011; current preliminary result is `NO-GO` |
| S-013 | Paddle image build | BLOCKED | Requires S-012 `GO` and explicit human resource authorization |
| S-014 | Paddle real structured OCR | BLOCKED | Requires accepted S-013 exact image |
| S-015 | Paddle offline/performance verification | BLOCKED | Requires accepted S-014 evidence |
| S-016 | Representative data quality comparison | BLOCKED | Human-approved fixture paths not provided |
| S-017 | Operations and ingress readiness recommendations | PENDING | Runtime/load evidence; no production mutations |
| S-018 | Consolidated target verification record | IN PROGRESS | Updated continuously at every stage |
| S-019 | Pre-deployment promotion decision | PENDING | S-010/S-011/S-012/S-016/S-017/S-018 |
| S-020 | Production deployment | BLOCKED | Explicit future human deployment authorization |

## Immediate execution queue

1. M4 baseline — commit the exact image IDs, synthetic fixture/privacy policy, cold and
   ready definitions, three warmups, twenty measured samples per base fixture,
   nearest-rank p50/p95, and one-second resource method before starting load containers.
2. T-006 harness — independently implement checksum-addressed M4 fixture, benchmark,
   saturation, and container wrapper evidence programs; orchestrator reviews every diff
   and runs syntax/self-checks before acceptance.
3. S-010 RapidOCR then Tesseract — run one hardened exact-image container at a time;
   retain raw redacted timing/stats/log evidence in a protected M4 stage.
4. S-011 RapidOCR then Tesseract — use one worker and fixed concurrency/queue/timeout
   settings to prove pre-body admission overflow, real-engine queue timeout,
   503/Retry-After, completion release, and instrumented component cancellation recovery
   without changing production configuration.
5. Record observed quality without percentages, keep production-representative S-016
   BLOCKED, apply independent evidence review, clean only M4 temporary artifacts, and
   push the accepted milestone to private `origin/main`.

## Goal

Create an independent repository for locally hosted OCR engines that share a secure,
versioned API and can be deployed and scaled independently for parallel external calls.

## Acceptance criteria

- The API contract, security limits, engine boundaries, and offline behavior are
  documented in `docs/specs/deployable-ocr-services.md`.
- RapidOCR, Tesseract, and Paddle Structure adapters implement the same normalized OCR
  contract, with structured output remaining optional.
- Authentication, invalid input, size/pixel limits, readiness, concurrency saturation,
  and successful fake-engine inference have automated tests.
- Per-engine images and Compose profiles render independently with health checks and no
  committed secrets.
- Repository-native verification commands and target-server smoke steps are documented.

## Tasks

- T-001 — Review the proposed API, engine split, offline guarantees, and security/resource
  boundaries (internal read-only reviewer after external CLI was denied) — ACCEPT
- Orchestrator — Implement shared application and contract tests — ACCEPT
- Orchestrator — Implement and test three engine adapters — ACCEPT
- Orchestrator — Add deployable images, Compose profiles, and operator documentation —
  ACCEPT (Paddle full image build remains a target-server check)
- T-002 — Independently review the completed diff and test evidence (platform-internal,
  read-only) — ACCEPT
- T-004 — Independently audit M2 S-004 through S-007 evidence — ACCEPT after REWORK:
  current interval, credential claims, exact commands, and checksum-addressed harness
  assertion logic corrected and independently re-reviewed
- T-005 — Independently audit M3 S-008/S-009 Tesseract evidence — ACCEPT after two
  REWORK cycles: five exact-command groups and the extended CURRENT timestamp were
  corrected, with all earlier decisions preserved in the report
- T-006 — Implement M4 fixture/benchmark/saturation evidence programs in a separate
  worktree — REASSIGN; the original worker's one allowed REWORK remained partial and
  retained correctness, privacy-scan, saturation, and evidence-capture defects
- Orchestrator — Run evidence gate and record final acceptance — ACCEPT FOR HANDOFF;
  Paddle production promotion remains deferred

## Verification gates

- Focused unit and API contract tests.
- Python bytecode compilation.
- Docker Compose rendering for every engine profile.
- Feasible image build and runtime smoke test on the current host.
- Explicit target-server checks for heavyweight and network-disabled inference.

## Decision log

- 2026-09-04: Created the local repository at
  `/home/ckc/test/codex/local-ocr-services`; no GitHub remote or deployment is authorized.
- 2026-09-04: Selected one shared API with separate engine images so consumers do not
  depend on engine-specific payloads and engines can scale independently.
- 2026-09-04: Selected RapidOCR as the default general OCR service, Tesseract as the
  low-resource baseline, and Paddle Structure for document semantics.
- 2026-09-04: Limited the first API slice to uploaded raster images. PDF ingestion,
  durable jobs, GPU images, and public ingress are deferred until target-server evidence
  establishes the need.
- 2026-09-04: The repository has no initial commit, and policy does not authorize one.
  Editing workers therefore cannot receive a compliant worktree. Implementation remains
  orchestrator-owned; read-only `grok-heavy` tasks provide independent review.
- 2026-09-04: The configured external `grok-heavy` CLI was denied because it would send
  local repository content to an external model service. Replaced it with a platform-
  internal read-only reviewer; no source file edits were delegated.
- 2026-09-04: ACCEPT T-001. Adopted all five must-fix findings: raw-body uploads,
  pre-body authentication/admission, bounded wait cardinality, precise line/layout
  schema and orientation rules, deterministic image validation, and immutable offline
  artifacts with network-disabled runtime evidence.
- 2026-09-04: RapidOCR and Tesseract images built successfully and passed both
  network-disabled real-engine warmup and authenticated HTTP OCR smoke tests. Paddle's
  full image was not built because the host has 13 GiB available RAM, no swap, and its
  configured runtime budget is 16 GiB; Dockerfile static validation is green and the
  exact build/runtime smoke remains assigned to the target server.
- 2026-09-04: REWORK T-002. The reviewer found premature inference-slot release on
  caller cancellation and an accidentally valid example API key. Added cancellation
  and pre-body saturation regressions, held slots until worker completion, made the
  placeholder invalid, corrected shell export guidance, narrowed the offline claim,
  and pinned the Python base-image digest. Also corrected Tesseract engine-version
  reporting. Awaiting independent confirmation before acceptance.
- 2026-09-04: ACCEPT T-002 after re-review. Both must-fix findings and the application-
  level admission evidence gap are resolved; no remaining must-fix defect was found.
- 2026-09-04: Evidence gate ACCEPT FOR HANDOFF. Every repository-local required gate
  has visible passing evidence: 38 tests, syntax, profile rendering, four Dockerfile
  checks, two feasible production-image builds, network-disabled real-engine warmups,
  and authenticated HTTP smokes. Scope stayed within the new local repository; no
  commit, remote, push, publication, or deployment occurred. Paddle's real build,
  structured OCR, cache completeness, and network-disabled operation are explicitly
  deferred to the target server and are not accepted as production-ready.
- 2026-09-04: The human selected the current local host as the target, authorized Docker
  validation, and required documentation-first staged records plus GitHub persistence at
  every completed milestone. Production deployment remains a separate blocked task.
- 2026-09-04: M1 S-001 inventory recorded Debian 12 on a KVM x86_64 guest with six
  exposed vCPUs, about 25.44 GiB total RAM, about 13.85 GiB available, no swap, 140 GiB
  Docker-filesystem free space, Docker 27.5.1, Compose 2.32.4, BuildKit 0.18.2,
  overlay2, cgroup v2, and fourteen running containers. Current Kafka and host-process
  evidence shows material CPU and memory contention; most co-located `ojbquay`
  containers have no Docker CPU/RAM limits.
- 2026-09-04: M1 S-002 sets RapidOCR and Tesseract to `CONDITIONAL`: architecture,
  memory, Docker, local exact images, registry/dependency routes, and `--network none`
  capability permit further validation, while production awaits current engine,
  performance, saturation, and representative fixture evidence. Paddle is `NO-GO` on
  this host because available RAM is below its 16 GiB runtime limit before OS, Docker,
  workload, and build headroom; no swap exists and no Paddle image was built.
- 2026-09-04: T-003 initial read-only review required correcting physical-core wording
  and adding host-level process evidence. A second rework corrected the evidence time
  window and stale quality-gate status. Final T-003 re-review is ACCEPT with no remaining
  evidence defect.
- 2026-09-04: `make check` passed in M1 with 38 tests, syntax for 18 Python files, and all
  three Compose profiles. This does not replace later real-engine runtime checks.
- 2026-09-04: Read-only GitHub checks found authenticated account `fallrising`; repository
  `fallrising/local-ocr-services` does not exist. Creating it, adding a remote, committing,
  and pushing remain blocked until the human specifies repository visibility.
- 2026-09-04: The M1 deployable source snapshot contains 42 non-ignored files excluding
  `.team/` and `docs/verification-target-de1.md`; its manifest-of-file-checksums SHA-256 is
  `b656f080d20a9c2da541629e4c7e5cd4771cfc0fb4109b131852e4713a13ee00`.
  This identity is not a Git commit, image digest, registry digest, or archive checksum.
- 2026-09-04: M1 technical evidence gate ACCEPT after T-003 rework and `make check`.
  Milestone closure and M2 remain blocked only on the required GitHub destination choice;
  production deployment remains independently blocked.
- 2026-09-04: The human confirmed creation of private GitHub repository
  `fallrising/local-ocr-services`, the initial commit, `origin`, and push. This authorization
  closes only the source-history persistence boundary; image publication and production
  deployment remain blocked.
- 2026-09-04: Created private repository `fallrising/local-ocr-services`, committed the
  accepted baseline as `c5a495b2f4f8ce5904fe13d6ea3c360c91fbc0bc`, added `origin`, and
  pushed `main`. `gh repo view` confirmed `isPrivate=true`; `git ls-remote` matched the
  local commit. M1 is COMPLETE and M2 is READY.
- 2026-09-04: S-004 DONE. M2 is based on clean local/remote commit
  `5e48987b71818fd834fddb71e4bda1a311757368`, exact RapidOCR image `c31f55d...ad845`,
  recorded Dockerfile/dependency/Compose/entrypoint checksums, a mode-0600 protected test
  credential with redacted handling evidence, and two mode-0700-directory synthetic fixtures with recorded checksums and
  dimensions. Benchmark/resource math is fixed; representative S-016 data remains
  blocked on human-approved fixtures. S-005 is IN PROGRESS.
- 2026-09-04: S-005 found that historical RapidOCR image `c31f55d...ad845`
  differs byte-for-byte from selected commit `5e48987...7a311` in six Python files and
  `requirements/rapidocr.txt`; all seven differences normalize to equality after removing
  terminal newline bytes. This is not a behavioral mismatch, but it prevents exact source
  provenance. Preserve the historical image and build a separate
  `local-ocr-services/rapidocr:verify-5e48987` artifact with measured current evidence.
- 2026-09-04: S-005 DONE. A 29-second no-cache build produced exact image
  `sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409`.
  Its embedded source aggregate, requirements, and entrypoint match the frozen host
  inputs; its four-file RapidOCR model manifest validates. `RepoDigests` remains empty.
  Build-window samples are host-wide because Docker uses a shared daemon and concurrent
  workloads remained active. S-006 is IN PROGRESS against only this resolved image ID.
- 2026-09-04: S-006 DONE. Exact image `2a80e84...663409` ran with UID/GID
  10001, read-only rootfs, no effective capabilities, `no-new-privileges`, loopback bind,
  and the planned CPU/RAM/PID limits. Live/ready, both 401 cases, and authenticated
  Traditional Chinese/English OCR passed with redacted schema evidence. S-007 is IN
  PROGRESS with the same exact image under `--network none`.
- 2026-09-04: S-007 DONE. Exact image `2a80e84...663409` completed a real
  RapidOCR warmup and a separate same-container-network-namespace HTTP smoke under
  `--network none`. Only loopback was visible; live/ready, both 401 paths, and redacted
  Traditional Chinese/English OCR passed. This proves operation under that network
  policy, not absence of all socket attempts. M2 is IN REVIEW pending the repository
  gate and independent evidence review.
- 2026-09-04: REWORK T-004. The reviewer accepted the consistent exact-image/runtime
  results but found four evidence reproducibility defects: the declared CURRENT interval
  excludes M2, one credential sentence overstates `--env-file` confinement, several
  material observations omit exact commands, and temporary HTTP harness logic lacks a
  durable checksum-addressed source. M2 remains IN REVIEW until all four are corrected
  and independently re-reviewed.
- 2026-09-04: ACCEPT T-004 after re-review. Both evidence programs are preserved under
  `.team/evidence/M2/`; final checksum-addressed S-006/S-007 reruns and corrected
  credential/time/command records resolved all four findings. The task and report pass
  `teamctl.py` validation.
- 2026-09-04: M2 technical evidence gate ACCEPT. `make check` passed after rework with
  38 tests, syntax for 18 Python files, and all three Compose profiles. The exact image
  remains `sha256:2a80e84...663409`; RapidOCR promotion remains `CONDITIONAL` pending
  S-010, S-011, and human-approved S-016. Temporary credentials, fixtures, logs, and
  archives were removed; the exact Docker image and repository evidence were retained.
  M2 closes only after the accepted record is committed and pushed to private GitHub.
- 2026-09-04: M2 COMPLETE. Accepted RapidOCR evidence was committed as
  `437fb00655c95a02741da4806bb363e4266ae111` and pushed to the approved private
  `fallrising/local-ocr-services` repository. `git ls-remote` exactly matched local HEAD,
  and `gh repo view` reconfirmed `isPrivate=true`. M3 S-008/S-009 is READY; formal
  deployment remains BLOCKED.
- 2026-09-04: M3 documentation-first start. Updated the living specification so
  Tesseract follows the evidence-driven provenance rule established by M2: preserve the
  historical image, compare it to a clean source baseline, and build a separate exact
  tag only if provenance differs. Commit/push this planning state before freezing S-008.
- 2026-09-04: S-008 baseline is clean/pushed commit
  `f6c21904ada9a30da4954d67c33df36099229ee3`. Historical Tesseract image
  `eff9305...c52ef5` has Tesseract engine 5.5.0, wrapper 0.3.13, and `eng`, `chi_sim`,
  `chi_tra`, and `osd`; its four-file tessdata manifest validates under `--network none`.
  Six Python files and `requirements/tesseract.txt` differ from the selected source only
  in terminal newline bytes. Preserve it and build separately tagged
  `local-ocr-services/tesseract:verify-f6c2190` for exact S-008/S-009 evidence.
- 2026-09-04: S-008 DONE. A 23-second no-cache build produced exact Tesseract image
  `sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77`.
  Embedded source, requirements, entrypoint, and four-file tessdata manifest match the
  frozen inputs; engine 5.5.0 and `eng`, `chi_sim`, `chi_tra`, `osd` are present.
  `RepoDigests` is empty. Build-window resource data remains host-wide under substantial
  shared load. S-009 is IN PROGRESS against only this image ID.
- 2026-09-04: S-009 DONE. Exact image `25b27d1...a9aec77` passed UID/GID,
  read-only rootfs, zero effective capabilities, `no-new-privileges`, loopback-bound
  online health/auth/real OCR, real `--network none` warmup, and same-network-namespace
  loopback HTTP OCR. Both synthetic fixtures matched their normalized expected hashes;
  no accuracy percentage is claimed. M3 is IN REVIEW.
- 2026-09-04: REWORK T-005. The reviewer found no conflicting image, engine, language,
  HTTP, or offline result. Acceptance is withheld because five command-provenance groups
  are summarized rather than recorded exactly: historical comparison, exact-image
  verification, build/resource/archive, credential/fixture creation, and log/mount
  privacy checks. Correct all five and re-review before cleanup or commit.
- 2026-09-04: T-005 rework implemented; independent re-review is pending. Added
  checksum-addressed historical-source comparison and private-input fixture-generation
  programs, reran historical/new-image provenance, archive/resource aggregation,
  fixture checksum, log-negative, and offline-mount checks, and documented exact commands
  plus non-passing exploratory/corrected attempts. M3 stays IN REVIEW; do not clean or
  commit until the reviewer returns ACCEPT.
- 2026-09-04: REWORK T-005 re-review. All five command-provenance groups are accepted;
  the only remaining correction is to extend the document-level CURRENT interval over
  the reviewer-rework commands. Exact closure captured at
  `2026-09-04T09:13:40+02:00`; final re-review remains required before cleanup/commit.
- 2026-09-04: ACCEPT T-005. Independent final re-review confirmed the CURRENT closure,
  all four preserved evidence sources, absent generated `__pycache__`, and no remaining
  M3 evidence defect. The orchestrator reran `make check` (38 tests, syntax, all Compose
  profiles), task/report validation, diff and secret/input scans, then removed only
  `/tmp/local-ocr-services-m3.Jt02KG` and `/tmp/local-ocr-services-m3-mount`. Exact image
  `25b27d1...a9aec77` remains local with no residual container. M3 is technically
  accepted but is not COMPLETE until both evidence and closure commits are pushed.
- 2026-09-04: M3 COMPLETE. Commit
  `f98e59a8a999aec3168735f5d119d12d83e57b94` contains the accepted Tesseract evidence
  and was pushed to private `origin/main`; a network-escalated `git ls-remote` returned
  that same hash. This bookkeeping update is the closure commit to push next. M4 is
  READY; Tesseract remains `CONDITIONAL`, and S-020 remains BLOCKED.
- 2026-09-04: M4 IN PROGRESS, documentation first. Direct loopback measurements have no
  supplied SLO and cannot include operator ingress latency. Fix three warmups and twenty
  sequential samples per base fixture, nearest-rank p50/p95, one-second Docker stats,
  exact accepted image IDs, and `1/1/0.2` saturation settings. New random synthetic
  fixtures remain private temporary data; human-approved representative S-016 data is
  still BLOCKED. Commit/push this plan before dispatching T-006 or starting Docker load.
- 2026-09-04: M4 preflight advisory adopted. One-second Docker stats yield maximum
  sampled values, not true peaks. `OCR_ENGINE_THREADS` is not wired into either accepted
  adapter and will be reported as a limitation rather than changed. Admission capacity
  includes authenticated upload/decode work, and static `Retry-After: 1` is not an ETA.
  Split pre-body overflow, repeated real-engine queue timeout/recovery, and exact-image
  component task-cancellation checks; an HTTP disconnect alone is not cancellation proof.
  Also correct M3 closure identity to pushed commit `c9f614d...fc67`.
- 2026-09-04: REWORK T-006 initial delivery. Static compilation, shell syntax, and the
  two self-tests pass, but the implementation cannot yet support the committed claims:
  fixtures are random pixels rather than private Traditional-Chinese/English text;
  readiness is timed as one successful request rather than elapsed from container start;
  it records one alleged cold OCR per fixture; percentiles are combined instead of
  per-fixture; the exact-image cancellation mode loads but never invokes the real
  backend; HTTP saturation parsing and quiescence are not conclusive; and the wrapper
  omits cold-start, host contention, security-state, component-mode, and privacy-negative
  evidence. The report was also overwritten without the required `STATUS` handoff.
  Return the same worker for one bounded rework; do not run load or copy these files to
  main until orchestrator verification accepts the corrected tools.
- 2026-09-04: REASSIGN T-006 after failed rework. The worker correctly reported
  `PARTIAL` because the host lacks Pillow, but its self-test encoded an incorrect
  nearest-rank implementation. For N=20 the committed formula
  `sorted_samples[ceil(p*n)-1]` selects zero-based indexes 9 and 18; the earlier
  orchestrator rework note that briefly said 10 and 19 was corrected before this
  decision. Other unresolved defects include a cold request per fixture instead of one
  global first post-ready request, holder bodies sent before quiescent recovery, no
  queue-timeout error-code assertion, a race after component worker completion, no
  during-host snapshot, unavailable `rg`, unproved privacy negatives, incomplete image
  and process/security capture, and compressed implementation style. Per the escalation
  table, reassign the bounded repair to `gpt-5.6-terra` at medium effort. No Docker load
  starts and no worker files reach `main` until orchestrator review and checks pass.
- 2026-09-04: PAUSE M4 at the human-requested checkpoint. The escalated T-006 worker
  was interrupted before completing its repair. Its unaccepted work remains only in
  local worktree `worktrees/local-ocr-services-T-006`; none of the candidate M4 programs
  was copied to `main` or pushed. At `2026-09-04T07:47:59+00:00`, filtered
  `docker ps --all` output for `m4-` was empty (exit 0), so this stage created no retained
  M4 container. Save only this plan, the detailed task/rework record, and the corrected
  nearest-rank specification to the approved private GitHub repository. RapidOCR and
  Tesseract remain `CONDITIONAL`; S-010/S-011 remain unexecuted; Paddle remains `NO-GO`;
  S-020 remains `BLOCKED` pending separate human authorization.
