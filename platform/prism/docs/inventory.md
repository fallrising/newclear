# Prism implementation inventory

P1-04 review baseline: newclear `c12d510daea7401ed0f70bf38377fe4e3578202a`,
including the merged P1-02 and P1-03 milestones. Historical verification below
retains its original scope. Product usage remains unknown.

## Code and contract coverage

| SDD task | Implemented evidence | Remaining boundary |
| --- | --- | --- |
| P0-01 | Go module, Makefile, golangci config, root Prism CI | CI includes a separate lint job beyond `make lint`. |
| P0-02 | `pkg/utm`, model/time/label/ID tests | Stable model; timestamp conversion belongs here. |
| P0-03 | `pkg/spi`, registration/capabilities/IR/iterator/error tests | All backends must use this contract. |
| P0-04 | `drivers/memory`, three stores and concurrency tests | Reference memory backend, not persistent production storage. |
| P0-05 | `pkg/spi/conformance`, deterministic fixtures and memory test | Memory passes supported capabilities; this does not verify future drivers or native pushdown. |
| P0-06 | `scripts/check-dependencies.sh` and deliberate violation tests | Wired into root Prism CI. |
| P0-07 | `internal/config` loader, env overrides, validation and security-warning tests | P1-04 adds `deploy/prismd.yaml` as a configuration example; the deployment stack remains P1-11. |
| P0-08 | `cmd/prismd`, `internal/server`, lifecycle and leak tests | P1-04 adds OTLP to all-in-one/ingest; query/ruler/console retain base HTTP routes. |
| P0-09 | ADR-001 through ADR-011 and clean-room declaration | Preserve decisions as later features are connected. |
| P0-10 | `internal/secret`, formatting and serialization redaction tests | Future secret-bearing config types still need integration coverage. |
| P0-11 | `internal/telemetry`, definition/exposition/cardinality-budget tests | `prismd.newRuntimeRegistry` registers Go/process collectors only; Prism self-telemetry is not connected. |
| P1-01 | `internal/ingest/normalize`, golden fixtures, delta state machine and fuzz seeds | Used by the runtime pipeline; P1-04 adds positional source-unit accounting. |
| P1-02 | [`internal/ingest/limits`](../internal/ingest/limits/README.md): tenant overrides, label/cardinality/record/span quotas, byte admission and bounded reports | Used by P1-03 and P1-04 runtime; complete tenant override configuration and registered telemetry remain outstanding. |
| P1-03 | [`internal/ingest`](../internal/ingest/README.md): bounded tenant registry, atomic reservation, normalization/limits, three priority lanes per signal, owned batches and SPI writers | P1-04 connects config/daemon/OTLP; registered pipeline telemetry is still unconnected. |
| P1-04 | `internal/compat/otlp`, configured single-tenant HTTP/gRPC runtime, original-unit accounting, bounded decode/admission and lifecycle tests | Full multi-tenant identity, native query APIs and production storage remain later work. |

The old README/portfolio description “Phase 0 SDD” omitted the implemented P1-01
normalizer. The opposite claim, “Phase 0 fully accepted”, would also be inaccurate:
the daemon telemetry gap and unimplemented production deployment remain visible.

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

## Integrated P1-03 verification

The reviewed package snapshot was integrated without changing its ten source,
test and package-document identities. Fresh checks ran on Linux amd64 with
`GOTOOLCHAIN=go1.23.12` and `GOFLAGS=-mod=readonly`; Go/module dependencies and the
public SPI remain unchanged.

| Exact command (from `platform/prism`) | Observed result |
| --- | --- |
| `GOTOOLCHAIN=go1.23.12 make lint test` | Formatting/vet pass; all 14 packages pass `-race -count=1`, including ingest (1.615s) and batcher (2.987s). |
| `GOTOOLCHAIN=go1.23.12 scripts/check-dependencies.sh` | PASS. |
| `GOTOOLCHAIN=go1.23.12 scripts/test-dependency-guard.sh` | All five deliberate prohibited-import cases detected; PASS. |
| `GOTOOLCHAIN=go1.23.12 go build ./...` | Exit 0. |
| `GOTOOLCHAIN=go1.23.12 golangci-lint run ./...` (CI-pinned v2.12.2) | `0 issues.`, exit 0. |

Independent review reran focused ingest race/vet and 20 repetitions of pipeline,
reservation and worker concurrency tests on the final unchanged snapshot. These
cover full-queue/mixed-priority atomic admission, delta replay without consuming
rejected byte quota, cancellation commit, tenant lifecycle and overrides,
expansion-product bounds, nested ownership and metadata capacity, finite retry,
concurrent admission/Close, deadline cancellation, and parent-cancel shutdown.
Both new packages run goroutine-leak checks. A transient-contention test flake
was corrected with retries restricted to admission-busy errors; intentional
queue/rate/tenant rejection tests require their precise causes.

These package/memory-backend tests do not establish HTTP/gRPC receiver wiring or
complete-stack behavior. No new daemon smoke is implied: runtime entrypoints and
configuration remain unchanged. The baseline HTTP smoke above retains only its
original scope.

## Integrated P1-04 verification

On Linux amd64, the integrated snapshot passed the following commands with
`GOTOOLCHAIN=go1.23.12` and `GOFLAGS=-mod=readonly`. Go/module versions and SPI
interfaces are unchanged. The external generator is telemetrygen v0.116.0,
installed separately from the module.

| Command | Observed result |
| --- | --- |
| `make lint test` | Formatting/vet pass; all 16 packages pass `-race -count=1`, including receiver, ingest, runtime and security. Long-lived packages use goleak. |
| `scripts/check-dependencies.sh` | PASS. |
| `scripts/test-dependency-guard.sh` | All five prohibited-import cases detected; PASS. |
| `go build ./...` | Exit 0. |
| CI-pinned golangci-lint v2.12.2 `run ./...` | 0 issues. |
| Pinned lint `run --build-tags=integration ./test/e2e` | 0 issues. |
| `OTLP_TELEMETRYGEN_BINARY=/tmp/prism-telemetrygen-v0.116.0/telemetrygen go test -tags=integration -race -count=1 -v ./test/e2e` | Both transports persist 1 metric, 1 log, 1 trace/2 spans after buffered shutdown flush; another tenant sees no data. |
| `go test -race -count=1 ./test/security` | 18 authentication/tenant-selector rejection cases plus real pipeline/SPI proof that reserved tenant labels cannot override authenticated identity; PASS. |
| `go build -o /tmp/prism-otlp-prismd ./cmd/prismd` then `python3 scripts/smoke-otlp.py --prismd /tmp/prism-otlp-prismd --telemetrygen /tmp/prism-telemetrygen-v0.116.0/telemetrygen` | Config-check, health, metrics, HTTP authentication on all signals, gRPC export and SIGTERM exit 0; PASS. |

Independent review checks the frozen implementation, focused race/vet and repeated
receiver/accounting/cancellation regressions. Coverage includes shared predecode
capacity, bounded nesting/compression, exact wire-byte metering, unsupported
encoding, original-point partial counts, delta baselines, metadata warnings,
auth/tenant isolation, current and deprecated OTLP scope representations,
full-success responses, retry hints, cancellation and orderly/forced shutdown.
Bounded protobuf and JSON fuzz targets supplement deterministic wire regressions.
The [receiver README](../internal/compat/otlp/README.md) describes the protocol
limits and native gRPC error boundary.

An initial full-suite invocation used a test-tool variable with a `PRISM_` prefix;
strict config validation correctly rejected it. The harness now uses the separate
`OTLP_TELEMETRYGEN_BINARY` name; the config validator was not relaxed. A pre-existing
batcher fixture was made deterministic by retrying only admission-lock contention,
while retaining its intended oversize assertion. Historical failures and initial
partial reviews remain in delivery evidence. The security check covers this
milestone; it does not establish future Phase 5 security acceptance.

## Current integration boundary

P1-04 connects the existing atomic pipeline to authenticated OTLP in the
all-in-one and ingest roles. The [receiver design](specs/p1-04-otlp.md) and
[ADR-011](sdd/13-ADR.md#adr-011phase-1-otlp-寫入使用單租戶-file-backed-bearer)
record the initial single-tenant identity contract and original-unit partial
counts. The [pipeline contract](../internal/ingest/README.md) retains P1-03's
byte-admission cancellation point, delta replay guarantees, tenant lifecycle,
owned payloads, metadata capacity, finite retry and at-least-once writes.

Runtime capacity differs from standalone package defaults: one tenant, depth-4
priority queues, two workers per signal and 16 concurrent receiver requests.
Configuration validates a conservative logical budget before startup, including
compressed/decompressed receive buffers and serialized admission (936 MiB at
defaults). This is not
an RSS limit: decoded pdata, allocator/transient/state costs and memory-backend
retention remain additional. The standalone package's 5,808 MiB conservative
default allowance documented in P1-03 remains unchanged; daemon wiring does not
use that multi-tenant default.

Remaining integration work includes:

- Register/populate pipeline self-telemetry and translate bounded diagnostics to
  registry domains; package reports do not deliver alerts.
- Complete multi-tenant API-key/mTLS identity and live reload. Strict ingest
  currently fails closed, and headers cannot select another tenant.
- Expose the complete limits policy through configuration/control-plane APIs;
  only the four existing limits fields are wired in this milestone.
- Preserve trace truncation information across batches; already persisted spans
  cannot be retroactively changed by the limits package.
- Establish process-memory/soak evidence with a bounded persistent backend;
  logical configuration arithmetic is insufficient to claim production capacity.

## Remaining phases

P1-05–06 supply remote-write and Loki receivers; P1-07–08 the PromQL adapter
and API; P1-09–10 ClickHouse; P1-11 deployment. Phase 2 adds LogQL and alerting;
Phase 3 APM and alternate-driver proof; Phase 4 the agent; Phase 5 control plane,
security and operations. The directories for compatibility, differential,
PromQL, E2E, security and soak acceptance mostly remain placeholders.

No external-driver conformance, Grafana datasource acceptance, complete-stack
E2E, production soak, deployment or production-readiness claim follows from the
focused ingest checks. Follow the [SDD task order](sdd/12-IMPLEMENTATION-PHASES.md).

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
