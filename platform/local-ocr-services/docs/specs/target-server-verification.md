# Target Server Verification

## Context

The current local host is the selected deployment-candidate server. RapidOCR and
Tesseract images already exist on it, but their earlier checks are historical evidence.
Paddle Structure has not completed a real image build or runtime verification. Promotion
decisions require current, server-specific evidence that remains distinct from the
2026-09-04 history in `docs/verification.md`.

## Goal

Produce reproducible compatibility, artifact, security, functional, offline, resource,
latency, saturation, and operational evidence for each OCR service before any production
deployment is authorized.

## Non-goals

- Rebuild an existing exact image only to repeat already-supported historical work.
- Claim an accuracy percentage without a labelled representative data set and metric.
- Prove absence of socket attempts from a successful `--network none` run.
- Publish source or images, expose public ingress, or start a production stack without
  explicit human authorization.
- Build Paddle Structure unless capacity evidence is `GO` and its resource use is
  separately authorized.

## Acceptance Criteria

- Given the selected host, when inventory is collected, then OS, kernel, architecture,
  CPU topology and flags, RAM, swap, Docker storage, Docker/Compose/BuildKit, cgroups,
  security mode, running workloads, and network constraints are recorded with commands,
  exit codes, timestamps, and key output.
- Given the inventory, when compatibility is assessed, then RapidOCR, Tesseract, and
  Paddle Structure each receive `GO`, `CONDITIONAL`, or `NO-GO` supported by current host
  evidence. A non-amd64 host stops all later image work.
- Given an exact engine image, when security and HTTP smoke checks run, then the evidence
  covers UID/GID `10001:10001`, read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, liveness, readiness, missing and invalid API-key 401 responses,
  and authenticated real-image OCR with a redacted request record.
- Given the same exact image, when it runs with `--network none`, then real engine warmup
  and loopback HTTP health, authentication, and OCR succeed from the same network
  namespace. The claim is limited to operability under that network policy.
- Given benchmark fixtures, when measurements run, then warmup count, sample count,
  p50/p95 method, image dimensions and checksums, cold/ready/OCR latency, peak container
  memory, CPU use, and observable OCR quality are recorded without logging image content
  or the API key.
- Given bounded concurrency settings, when saturation is induced, then admission limit,
  queue timeout, HTTP 503, `Retry-After`, capacity release, and resource effects are
  observed with one Uvicorn worker.
- Given Paddle capacity is not safely available, when its gate is evaluated, then work
  stops at `NO-GO` or `DEFERRED` without adding swap, weakening limits, or changing host
  resources.
- Given a milestone is accepted, when its record is finalized, then the living plan and
  verification document include exact evidence and the accepted source state is saved to
  the human-approved GitHub repository. A milestone is not marked complete while its
  required GitHub destination is unknown.

## Constraints

- CPU-first Linux amd64/x86_64, Python 3.11, one Uvicorn worker per container.
- Existing user files and images must be preserved. Cleanup is limited to temporary
  artifacts created and identified during the current verification stage.
- API keys must be generated outside the repository, passed without command-line or log
  disclosure where practical, and never committed.
- Test fixtures must be explicitly safe to process; record checksums and metadata, not
  sensitive image contents.
- Existing local image IDs are Docker content identities, not registry manifest digests.
  Archive SHA-256 values, if produced, are labelled separately.
- Compose remains loopback-bound. TLS, body limits, timeouts, rate/connection limits, IP
  allowlists, and public ingress belong to an operator-owned reverse proxy.
- Commit, remote, push, image publication, production ingress changes, and production
  startup remain separate authorization boundaries. Milestone source-history persistence
  is established at private `fallrising/local-ocr-services`; image publication and
  production deployment are not authorized by that repository permission.

## Assumptions and Unknowns

- Verified: the selected target is the current local host.
- Verified historically: RapidOCR and Tesseract images built and passed real engine
  warmup with networking disabled and authenticated HTTP OCR on this host.
- Unknown until current inventory: host contention, Docker security configuration,
  BuildKit availability, outbound policy, and safe capacity for each service.
- Unknown until fixture selection: representative data set, expected concurrency/QPS,
  latency target, and measurable quality criteria.
- Unknown for M4: no operator SLO, expected QPS, or production-representative fixture
  set has been supplied. M4 therefore reports measurements rather than pass/fail latency
  or accuracy claims, and it cannot complete representative S-016 quality validation.
- Verified: private GitHub repository `fallrising/local-ocr-services` stores accepted
  source-history milestones on `origin/main`.

## Design

Verification is split into gated milestones. Each milestone updates the plan and a target
server verification record before acceptance:

1. **M1 — Inventory and capacity:** S-001 and S-002 using read-only host and Docker
   inspection plus a disposable `--network none` capability check.
2. **M2 — RapidOCR:** freeze S-004 inputs, compare the historical image to the selected
   source, rebuild a separately tagged exact image when provenance differs, then complete
   S-006 and S-007 against only the resolved image ID.
3. **M3 — Tesseract:** freeze S-008 inputs, apply the same provenance/build identity
   rule, verify the real engine version and required language data, then complete S-009
   security, HTTP, and network-disabled checks against one resolved image ID.
4. **M4 — Load evidence:** complete S-010, S-011, and the applicable S-016 fixtures for
   RapidOCR and Tesseract.
5. **M5 — Paddle gate:** complete S-012. Run S-013 through S-015 only after `GO` and
   explicit approval of the required resources.
6. **M6 — Promotion decision:** complete remaining S-016, S-017, S-018, and S-019.
7. **M7 — Production:** S-020 remains blocked until separately authorized.

### M4 measurement protocol

M4 uses only the accepted exact local images:

- RapidOCR: `sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409`
- Tesseract: `sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77`

Run one engine container at a time with one Uvicorn worker, the accepted security
envelope, two CPUs, its existing memory limit, and a loopback-only published port.
Record the exact image ID and runtime configuration again. Direct loopback HTTP latency
does not include reverse-proxy or Internet effects.

`OCR_ENGINE_THREADS` is present in configuration but neither current RapidOCR nor
Tesseract adapter wires it into the underlying engine. M4 must not describe either
engine as restricted to two engine threads. Fixing that wiring would change the image
artifact and is outside this measurement-only milestone.

Generate a new M4-only set of non-sensitive synthetic PNGs in a mode-0700 temporary
directory. Text and the random test API key remain mode 0600 and are never printed,
logged, or committed. Record only image checksums, byte sizes, dimensions, media type,
and redacted OCR observations. Use two different base sizes/languages for sequential
latency samples and a larger deterministic resize for saturation. These fixtures prove
engine behavior and relative resource cost only; they are not production-representative
S-016 evidence.

For each engine:

1. Measure container cold-start wall time around `docker run --detach`, then poll
   `/health/ready` every 100 ms for at most 120 seconds and record first-200 duration.
2. Send the first authenticated OCR request immediately after readiness and record both
   loopback client elapsed time and response `elapsed_ms` as cold OCR observations.
3. Send three warmup requests per base fixture and exclude them from percentiles.
4. Send twenty sequential measured requests per base fixture. Compute nearest-rank p50
   and p95 independently for client elapsed and response `elapsed_ms` using
   `sorted_samples[ceil(p * n) - 1]`; for N=20 these are zero-based indexes 9 and 18
   (the 10th and 19th ordered samples). Retain min/max and all raw timings outside Git
   until acceptance.
5. Sample `docker stats --no-stream` once per second from container start through the
   final request. Record maximum sampled Docker CPU percentage and memory, PIDs, OOM
   state, and the raw sample checksum. A one-second series cannot prove instantaneous
   peak CPU or RAM; report its maximum sampled memory as a lower-bound proxy for the
   requested peak. These are container observations; concurrent host workload and
   host-level snapshots before, during, and after remain separately labelled.

Use `OCR_MAX_CONCURRENCY=1`, `OCR_MAX_QUEUE_SIZE=1`, and
`OCR_QUEUE_TIMEOUT_SECONDS=0.2` for the real-engine saturation container. The admission
capacity is two total authenticated requests across upload, decode, running inference,
and inference wait; `OCR_MAX_QUEUE_SIZE` is not a standalone inference-queue counter.
`Retry-After` is statically `1`, not derived from the configured timeout or expected
remaining service time. Verify its exact value and retain this operational limitation.

A larger fixture must keep one real inference active longer than the timeout. Observe
these separate scenarios without increasing Uvicorn workers or enabling client retries:

```gherkin
Scenario: Admission capacity rejects overflow before body consumption
  Given two authenticated slow-body requests occupy the total admission capacity
  When a third authenticated request sends complete headers but no image body
  Then it returns immediate HTTP 503 capacity_exhausted
  And Retry-After is 1

Scenario: Real-engine queue timeout returns backpressure
  Given one real OCR inference occupies the only inference slot
  When a second admitted request waits longer than 0.2 seconds
  Then the second request returns HTTP 503 capacity_exhausted
  And Retry-After is 1
  And a later request returns 200 after the first inference completes

Scenario: Component cancellation does not release inference early or leak capacity
  Given the exact image loads its real backend through a checksum-addressed component harness
  And the harness observes the inference worker start
  When the awaiting asyncio task is cancelled
  Then a new operation times out while the original worker still runs
  And a later operation succeeds only after the original worker completes
```

Record response status, error code, `Retry-After`, request timing, post-scenario success,
container CPU/RAM/PIDs/OOM state, and redacted logs. Run real-engine queue timeout and
recovery at least twice per engine; if timing is inconsistent after at most three total
controlled attempts, report that check failed or inconclusive. A raw HTTP disconnect may
be recorded separately but cannot substitute for observed asyncio-task cancellation in
the component harness. Do not tune workers or weaken the acceptance claim.

The repository and images are already on the selected host, so S-003 uses no deployment
artifact transfer for M1. Any later GitHub push is source-history persistence, not image
promotion or production deployment.

## Steps

1. M1 complete: server inventory, capacity decisions, evidence gate, and private GitHub
   baseline were accepted without altering production configuration.
2. Freeze M2 source, Dockerfile/dependency, image, fixture, credential-handling,
   benchmark, resource-sampling, start-time, and server identities.
3. Compare the historical RapidOCR artifact to the frozen source, preserve it, and build
   a separately tagged exact artifact because byte provenance differed at terminal
   newlines; do not invent unavailable historical metrics.
4. Run RapidOCR security, authenticated HTTP, real-image, and `--network none` checks.
5. Review M2 evidence, run repository gates, update the plan, and push the accepted
   milestone to the private GitHub repository.
6. Repeat the frozen-baseline, provenance, exact-build-if-needed, security, real HTTP,
   and `--network none` sequence for Tesseract, explicitly verifying engine version and
   `eng`, `chi_sim`, and `chi_tra` data before M3 acceptance.
7. Freeze and commit the M4 protocol, harness scope, accepted exact image IDs, synthetic
   fixture policy, sample counts, percentile formula, resource method, and saturation
   scenarios before starting load containers.
8. Run RapidOCR benchmark and saturation first, then Tesseract, one container at a time.
   Preserve raw evidence under the protected M4 stage until independent acceptance.
9. Record S-016 as still blocked for production-representative quality data, apply the
   evidence gate, clean only M4 temporary artifacts, and persist the accepted milestone
   to the private GitHub repository.

## Verification

- `git diff --check`
- `make check`
- Exact host and Docker inventory commands recorded with exit codes in the target-server
  verification document.
- Independent evidence-gate review before each milestone completion claim.
- `git status --short --branch` and approved GitHub remote/commit identity recorded at
  milestone close.
- M4 harness syntax/self-checks plus exact-image benchmark and saturation commands;
  raw latency/resource/log artifacts remain checksum-addressed and outside Git.
