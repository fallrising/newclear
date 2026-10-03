# Prism implementation inventory

Reviewed 2026-10-03 against newclear `b43cdf4b0777414674d47edb71fd3b33dc5f536a`
plus the local P1-03 changes. P1-02 is included in that baseline. Historical
verification below retains its original scope. Product usage remains unknown.

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
| P1-01 | `internal/ingest/normalize`, golden fixtures, delta state machine and fuzz seeds | Called by the package-level P1-03 pipeline; receivers remain unconnected. |
| P1-02 | [`internal/ingest/limits`](../internal/ingest/limits/README.md): tenant overrides, label/cardinality/record/span quotas, byte admission and bounded reports | Used by P1-03; runtime/config/receiver/telemetry wiring remains outstanding. |
| P1-03 | [`internal/ingest`](../internal/ingest/README.md): bounded tenant registry, atomic reservation, normalization/limits, three priority lanes per signal, owned batches and SPI writers | Package options only; daemon, receiver, config and self-telemetry registration are not connected. |

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

## Next integration boundary

P1-03 owns a fixed, non-evicting tenant registry and resolves effective tenant
attribute limits before normalization. Preflight and queue reservation precede
byte admission and stateful delta conversion. Queued payloads own their data;
metadata consumes the same finite metric-lane capacity. The
[pipeline contract](../internal/ingest/README.md) defines admission, cancellation,
priority, retry, payload accounting and shutdown behavior.

Later runtime integration still must:

- Authenticate callers and supply a trusted tenant identity. The package context
  helper does not authenticate requests.
- Map whole-request admission errors and per-record outcomes to HTTP/gRPC.
  Normalized UTM record counts are not OTLP rejected-data-point counts.
- Translate normalization and limit reports into registered telemetry domains;
  package snapshots do not register metrics or deliver alerts.
- Set a deployment-wide capacity budget across tenants, signals, priority lanes,
  queues and workers. The conservative default three-signal formula permits
  5,808 MiB of logical payload, before transient allocations and tenant state;
  it does not meet or establish the SDD 1 GiB process-memory target. Logical
  payload bounds are not a process RSS guarantee.
- Preserve trace truncation information across batches. Previously persisted
  spans cannot be mutated retroactively by the limits package.

The existing config type exposes only four limits settings. Complete YAML/env/
control-plane configurability requires synchronized type/default/validation/SDD/
deployment changes; a package options API alone does not provide it. Tenant state
lasts until pipeline close; live configuration reload and registry eviction are
outside this slice.

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
