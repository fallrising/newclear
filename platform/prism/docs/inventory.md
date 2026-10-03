# Prism implementation inventory

Reviewed 2026-10-03 against newclear `82cd9d8159b31cdd852f333a219132dc614e5d66`.
The later main snapshot `1e4bd8e` has no changes to Prism, its instructions or its
portfolio row. Development resumed on 2026-10-03. Product usage remains unknown.

## Code and contract coverage

| SDD task | Implemented evidence | Remaining boundary |
| --- | --- | --- |
| P0-01 | Go module, Makefile, golangci config, root Prism CI | CI includes a separate lint job beyond `make lint`. |
| P0-02 | `pkg/utm`, model/time/label/ID tests | Stable model; timestamp conversion belongs here. |
| P0-03 | `pkg/spi`, registration/capabilities/IR/iterator/error tests | All backends must use this contract. |
| P0-04 | `drivers/memory`, three stores and concurrency tests | Reference memory backend, not persistent production storage. |
| P0-05 | `pkg/spi/conformance`, deterministic fixtures and memory test | Memory passes supported capabilities; this does not verify future drivers or native pushdown. |
| P0-06 | `scripts/check-dependencies.sh` and deliberate violation tests | Wired into root Prism CI. |
| P0-07 | `internal/config` loader, env overrides, validation and security-warning tests | Acceptance names `deploy/prismd.yaml`, but only `internal/config/testdata/prismd.yaml` exists. Deployment artifacts are scheduled P1-11. |
| P0-08 | `cmd/prismd`, `internal/server`, lifecycle and leak tests | All role entrypoints currently start the same base HTTP routes. |
| P0-09 | ADR-001 through ADR-010 and clean-room declaration | Preserve decisions as later features are connected. |
| P0-10 | `internal/secret`, formatting and serialization redaction tests | Future secret-bearing config types still need integration coverage. |
| P0-11 | `internal/telemetry`, definition/exposition/cardinality-budget tests | `prismd.newRuntimeRegistry` registers Go/process collectors only; Prism self-telemetry is not connected. |
| P1-01 | `internal/ingest/normalize`, golden fixtures, delta state machine and fuzz seeds | No receiver/pipeline calls the normalizer yet. |
| P1-02 | Verified standalone [`internal/ingest/limits`](../internal/ingest/limits/README.md): tenant overrides, label/cardinality/record/span quotas, byte admission and bounded reports | Full module gates pass below; runtime/config/receiver/telemetry wiring remains P1-03 and later. |

The old README/portfolio description “Phase 0 SDD” omitted the implemented P1-01
normalizer. The opposite claim, “Phase 0 fully accepted”, would also be inaccurate:
the deployment-config and daemon telemetry gaps above remain visible.

## Baseline verification

Executed from `platform/prism` on Linux amd64 using Go 1.23.0:

| Command / probe | Observed result |
| --- | --- |
| `make lint test` | Formatting/vet pass; race-enabled suite passes in all 11 baseline packages. |
| `scripts/check-dependencies.sh` | PASS. |
| `scripts/test-dependency-guard.sh` | All five prohibited-import cases detected: pkg-to-driver, driver-to-internal, driver-to-driver, compat-to-driver, AGPL. |
| `go build ./...` | Exit 0. |
| `go run ./cmd/prismd --config internal/config/testdata/prismd.yaml --config-check` | `prismd: configuration valid`. |
| Built `prismd`, started on an ephemeral loopback port with fixture config | Health 200/`ok`, metrics 200 with Go/process collectors, no `prism_ingest_*`; SIGTERM exit 0 within 0.001 seconds. |
| `golangci-lint run ./...` using CI-pinned v2.12.2 | `0 issues.` |

The actual daemon smoke is stronger evidence than the isolated telemetry registry
unit test: that test constructs its own registry and populates sample series.
Neither establishes production observability readiness.

## Integrated P1-02 verification

Executed after copying the frozen package into the delivery tree, on Linux amd64
with `GOTOOLCHAIN=go1.23.12`. The module remains Go 1.23.0; dependencies and public
SPI are unchanged.

| Exact command (from `platform/prism`) | Observed result |
| --- | --- |
| `GOTOOLCHAIN=go1.23.12 make lint test` | Formatting and vet pass; all 12 packages pass `-race -count=1`, including limits (14.918s). |
| `GOTOOLCHAIN=go1.23.12 scripts/check-dependencies.sh` | PASS. |
| `GOTOOLCHAIN=go1.23.12 scripts/test-dependency-guard.sh` | All five deliberate prohibited-import cases detected; PASS. |
| `GOTOOLCHAIN=go1.23.12 go build ./...` | Exit 0. |
| `GOTOOLCHAIN=go1.23.12 golangci-lint run ./...` (CI-pinned v2.12.2) | `0 issues.`, exit 0. |

The limits tests cover effective overrides, trusted identities, UTF-8/collision
boundaries, denied labels, existing series at capacity, sliding expiry, log/attrs
and span caps, byte throttling, cancellation, caller ownership and concurrent
access. Fifteen deterministic HLL samples (1k–500k identities, three seeds each)
observed a maximum relative error of 1.4386%, below 3%; duplicate/removal checks
also pass. This is sampled evidence, not a universal error guarantee.

The [package README](../internal/ingest/limits/README.md) documents exact LRU
admission alongside the fixed 3,424,256-byte HLL state, supporting capacities,
marker preservation, partial results and report consumption. Per-tenant bounds
do not establish a whole-process memory budget. The earlier HTTP smoke remains
applicable: this standalone package is not imported by the daemon and changes no
runtime wiring. No additional complete-stack smoke or E2E result is implied.

## Next integration boundary

P1-03 adds the bounded pipeline/batcher after P1-02. Its integration must cover:

- Resolve tenant overrides before normalization. The current normalizer already
  truncates attributes to its effective maximum and applies a fixed high-cardinality
  denylist; a downstream limiter cannot restore removed input.
- Define an explicit translation for normalization report actions/reasons to the
  registered telemetry domains. Current `drop`, `rename`, and `clamp` keys differ
  from registry `drop_label`, `sanitize_name`, and `clamp_time`.
- Own a bounded collection of tenant limiters and their configuration lifecycle.
  A bounded per-tenant instance is not a global tenant bound.
- Consume byte-rate retry information, rejection reports and bounded cardinality
  observations. HTTP/gRPC error mapping belongs to receivers; alert delivery is
  part of the later alerting phase.
- Preserve trace truncation information across batches. Already persisted spans
  cannot be mutated retroactively by a standalone limits package.

The existing config type exposes only four limits settings. Complete YAML/env/
control-plane configurability requires synchronized type/default/validation/SDD/
deployment changes; a package options API alone does not provide it.

## Remaining phases

P1-04–06 supply OTLP, remote-write and Loki receivers; P1-07–08 the PromQL adapter
and API; P1-09–10 ClickHouse; P1-11 deployment. Phase 2 adds LogQL and alerting;
Phase 3 APM and alternate-driver proof; Phase 4 the agent; Phase 5 control plane,
security and operations. The directories for compatibility, differential,
PromQL, E2E, security and soak acceptance mostly remain placeholders.

No external-driver conformance, Grafana datasource acceptance, complete-stack
E2E, production soak, deployment or production-readiness claim follows from the
local package checks. Follow the [SDD task order](sdd/12-IMPLEMENTATION-PHASES.md).

## Go style reference

This delivery also consults [JetBrains Modern Go Guidelines](https://github.com/JetBrains/go-modern-guidelines),
using its `use-modern-go` CLI v0.1.1 to resolve this component's `go.mod` (Go 1.23).
The inspected upstream checkout is `155dc7ca10da5e1f6c841503086957b1b37f5815`.
Review applies supported idioms such as integer range, `min`/`max`, `maps.Clone`,
`slices.Clone`/`Contains`/`SortFunc`, and `strings.Clone`; it preserves behavior and
context-cancellation checks where a shorthand would change them. The existing
`modernize` linter remains enabled. No Go language-version upgrade is included.

The guideline CLI may require a newer toolchain to run; its own toolchain does
not change Prism's language target. Final module checks use CI's Go 1.23.12.
