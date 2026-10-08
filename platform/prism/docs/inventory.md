# Prism implementation inventory

Current development baseline: Go 1.27.1. P1-10 uses source baseline
`eeca95d015fdd1122c8b10c2f5b093bdc1f481af`; the update from its original
`12f322f28aba0d8e9180a1a65c18e2d34e23ff48` contained only unrelated ERU changes.
P1-09 was implemented from
newclear `c7d709be5475324e8f954f256671a3d4e13e2917` after merged P1-08 PR290.
The P1-05 source completed at `6deaabcc583f96b543c55f82b7922cfe772e2831`. Historical verification below
retains its original versions and scope. Product usage remains unknown.

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
| P0-08 | `cmd/prismd`, `internal/server`, lifecycle and leak tests | P1-04 adds OTLP to all-in-one/ingest; P1-08 adds query routes; ruler/console retain base HTTP routes. |
| P0-09 | ADR-001 through ADR-019 and clean-room declaration | Preserve decisions as later features are connected. |
| P0-10 | `internal/secret`, formatting and serialization redaction tests | Future secret-bearing config types still need integration coverage. |
| P0-11 | `internal/telemetry`, definition/exposition/cardinality-budget tests | P1-08 registers Prism collectors and connects query telemetry; pipeline event counters remain unconnected. |
| P1-01 | `internal/ingest/normalize`, golden fixtures, delta state machine and fuzz seeds | Used by the runtime pipeline; P1-04 adds positional source-unit accounting. |
| P1-02 | [`internal/ingest/limits`](../internal/ingest/limits/README.md): tenant overrides, label/cardinality/record/span quotas, byte admission and bounded reports | Used by P1-03 and P1-04 runtime; complete tenant override configuration and registered telemetry remain outstanding. |
| P1-03 | [`internal/ingest`](../internal/ingest/README.md): bounded tenant registry, atomic reservation, normalization/limits, three priority lanes per signal, owned batches and SPI writers | P1-04 connects config/daemon/OTLP; registered pipeline telemetry is still unconnected. |
| P1-04 | `internal/compat/otlp`, configured single-tenant HTTP/gRPC runtime, original-unit accounting, bounded decode/admission and lifecycle tests | Full multi-tenant identity, native query APIs and production storage remain later work. |
| P1-05 | `internal/compat/promapi`, bounded snappy/protobuf v1 receiver, authenticated runtime routing and combined capacity validation | v2, native histograms and full multi-tenant control plane remain later work. |
| P1-06 | `internal/compat/lokiapi`, bounded authenticated JSON/gzip push, structured metadata, runtime and real Vector acceptance | Protobuf push and Loki query/ready remain future milestones. |
| P1-07 | `internal/query/promqladapter`, bounded tenant-scoped streaming lifetime bridge and official float corpus through memory SPI | Native histograms and other drivers remain later work. |
| P1-08 | `internal/compat/promapi/query*`, query/all-in-one runtime, bounded native/fallback APIs, real promtool gate | Rules/alerts/remote_read, native histograms and multi-tenant control plane remain later work. |
| P1-09 | Native ClickHouse registration/lifecycle, eight migrations and metrics/logs/traces writes; test-only SQL readback | Production query implementations and daemon wiring remain P1-10. Full conformance and deployment are not claimed. |
| P1-10 | Mandatory ClickHouse SPI reads, additive migrations 009/010, bounded iterators/catalogs, daemon selection and isolated real-database test factories | Optional native/metadata/delete/RED/dependency queries, compose/Grafana and deployment remain later scope. Verification is recorded below. |
| P1-11 | Phase 1 three-service pinned Compose, nonroot daemon build, four datasource definitions, five dashboards, healthcheck/version/readiness/systemd notifications and owned E2E runner | Root local build, complete actual Compose ingestion/Grafana health/query/panel, same-container restarts and exact cleanup pass; historical failures and current limits are recorded below. |

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

## Integrated P1-05 verification

The integrated 2026-10-04 snapshot was tested on Linux amd64 with
`GOTOOLCHAIN=go1.23.12 GOFLAGS=-mod=readonly`. Module versions, public SPI,
drivers and root CI workflows are unchanged. The receiver and runtime workers
used isolated worktrees; the orchestrator integrated their frozen files by hash.

| Command | Observed result |
| --- | --- |
| `make lint test` | Formatting/vet pass; all 17 packages pass race tests, including promapi, ingest, runtime and security; long-lived packages use goleak. |
| `scripts/check-dependencies.sh` and `scripts/test-dependency-guard.sh` | Direction guard and all five prohibited-import cases pass. |
| `go build ./...` | Exit 0. |
| Pinned golangci-lint v2.12.2 `run ./...` and `run --build-tags=integration ./test/e2e` | Both report 0 issues. |
| `PROMETHEUS_BINARY=/tmp/prism-prometheus-2.53.0/prometheus OTLP_TELEMETRYGEN_BINARY=/tmp/prism-telemetrygen-v0.116.0/telemetrygen go test -tags=integration -race -count=1 -v ./test/e2e` | Real Prometheus scrape/WAL/remote-write persists up=1 and fixture=42.5; another tenant is empty. Existing telemetrygen HTTP/gRPC three-signal persistence and shutdown regressions pass. |
| `go test -race -count=1 -v ./test/security` | Existing OTLP checks and six remote-write credential/selector rejection cases pass; rejected requests create no tenant state; parsed reserved labels cannot override stored identity. |
| `go build -o /tmp/prism-p1-05-prismd ./cmd/prismd` then `python3 scripts/smoke-otlp.py --prismd /tmp/prism-p1-05-prismd --telemetrygen /tmp/prism-telemetrygen-v0.116.0/telemetrygen` | Actual daemon config/health/metrics/OTLP plus remote-write authentication, empty-v1 admission and v2 rejection pass; SIGTERM exits 0. |
| `go test ./internal/compat/promapi -run '^$' -fuzz '^FuzzWriteParser$' -fuzztime=10s -parallel=2` | Worker parser fuzz passes 85,705 executions in 11.054s; deterministic cases cover schema/count/packed and unpacked fields, Snappy expansion and unknown fields. |

The [P1-05 contract](specs/p1-05-remote-write.md) and
[receiver README](../internal/compat/promapi/README.md) explain original-byte
accounting, nonretryable partial 400, fixed diagnostics, one-slot admission and
cancellation cleanup before permit release. Narrow legacy normalizer changes add
cancellation checks and a byte cap; its old decode helper still lacks schema
preflight and is not used by network receivers. Initial receiver-absent and
501/404 red tests, budget-boundary failures and intermediate lint/fixture failures
were retained and resolved before these final checks. No validator was weakened.

## Go 1.27 maintenance verification — 2026-10-04

The [upgrade contract](specs/go-1.27-upgrade.md) moves the active module, CI and
development instructions to Go 1.27.1 with golangci-lint v2.14.0. All runtime
dependency versions and go.sum remain unchanged. Earlier commands above are
historical evidence, not commands for the current minimum toolchain.

Local verification on the final upgrade source passed:

- `GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly make lint test`: format, vet,
  race and leak checks across all 17 packages.
- Dependency guard and all five negative fixtures; `go build ./...`;
  `go mod verify`; unchanged module versions and go.sum.
- golangci-lint v2.14.0 for normal and integration builds: zero issues.
- Real Prometheus 2.53.0 remote_write and telemetrygen v0.116.0 OTLP clients,
  tenant isolation, security tests and executable daemon smoke/SIGTERM.
- `CGO_ENABLED=0` daemon build and build metadata, config check, and explicit
  minimum-version rejection with an older compiler and `GOTOOLCHAIN=local`.
- Twenty race-enabled cancellation/close/shutdown repetitions across ingest
  and server packages. A failing incomplete-body fixture was corrected to
  wait for server-side connection closure while retaining its keep-alive
  request and shutdown assertions; no sleep or leak exclusion was added.

Raising the language directive enabled additional lint checks. Necessary
corrections preserve reflection traversal, error classification and owned
concurrent work; enabled checks and public SPI interfaces are unchanged.
The existing SDD22 container recipe is updated, but no Dockerfile or deployment
is implemented by this maintenance change.

## P1-06 verification

Final local verification uses Go 1.27.1 with `GOFLAGS=-mod=readonly`:

| Command / scope | Observed result |
| --- | --- |
| `make lint test` | Format/vet/race/goleak pass across 18 packages. |
| `scripts/check-dependencies.sh`, `scripts/test-dependency-guard.sh`, `go build ./...` | Dependency direction and all five negative fixtures pass; build exits 0. |
| golangci-lint v2.14.0 normal and integration builds | Both report zero issues. |
| `go test -tags=integration -race -count=1 -v ./test/e2e` with the documented three binaries | Real Vector 0.45.0 none/gzip JSON modes each persist two exact bodies, resource/trace/span metadata and no records for another tenant. Prometheus 2.53.0 and telemetrygen 0.116.0 acceptance remains green. |
| `go test -race -count=1 -v ./test/security` | Six Loki credential/selector rejection cases preserve zero tenant state; parsed reserved labels cannot replace Resource.Tenant. Existing OTLP/remote_write security cases pass. |
| Built daemon plus `scripts/smoke-otlp.py` | Configuration/health/metrics, OTLP, remote_write and nonempty authenticated Loki push pass; SIGTERM exits 0. |
| `go mod verify`, baseline module list and module-file comparison | All modules verified; dependency versions, go.mod and go.sum unchanged. |

The [P1-06 contract](specs/p1-06-loki-push.md) and
[receiver README](../internal/compat/lokiapi/README.md) define strict JSON shape,
gzip integrity, token and projected-allocation caps, original-byte charging,
fixed diagnostics and callback ownership. Runtime tests also cover TLS, both
ingest roles, route exclusion from non-ingest roles, independent receive slots,
client disconnection, forced shutdown and backend-close ordering. Decoder fuzz,
malformed-body/duplicate/UTF8/metadata/partial-commit and cancellation tests cover
the protocol boundary. Initial missing-route and budget red tests, lint findings
and an incorrect metric-style tenant-label expectation in log tests were retained
and resolved; tests now assert the existing Resource.Tenant log contract and the
absence of attacker-supplied reserved labels. No validator was weakened.

## P1-07 verification

The [adapter contract](specs/p1-07-promql-adapter.md) records the lifetime bridge
required by SPI's borrowed series and Prometheus's retained series. Labels are
copied, samples are streamed through exact-series reselection, and querier
limits cover cumulative scan/reopen work and owned metadata. This increases
selection calls and does not promise a snapshot across concurrent writes or a
backend/process RSS bound. The public SPI and drivers are unchanged.

Official v0.53.0 input inventory: 12 files, 768 eval directives. 579 are
float-compatible; 189 explicitly depend on unsupported native histograms.
The Apache-2.0 core harness is adapted to write fixtures directly into memory
SPI while retaining upstream result comparison and instant/range/@ expansion.
This avoids importing an ISC-licensed diagnostic dependency from the original
test harness. The final integrated Go 1.27.1 checks passed:

- `make lint test`: 20 packages with race/goleak, vet and formatting.
- Dependency guard and all five negative fixtures; `go build ./...`.
- golangci-lint 2.14.0: zero issues.
- `go test -race -count=1 -v ./test/promqltest -driver=memory`: all 579 supported
  directives passed, expanding to 6,296 actual engine queries, 78 SPI writes,
  47,497 loaded fixture rows and 29,908 Select calls.
- `go test -race -count=1 -v ./test/security`: real engine trusted-tenant,
  nested selector, reserved label and existing ingest regressions passed.
- `go mod verify` and unchanged full selected module-version graph. Only 11
  existing-version indirect requirements and 13 checksum lines were activated.

Focused matcher, forward-Seek and float-fixture fuzzing passed. The terminal
Seek cancellation bug found by review/fuzzing and native vet's mistaken
io.Seeker heuristic were corrected; no analyzer was disabled. A timestamp type
alias preserves the exact Prometheus interface with a compile-time assertion.
Final review also found and corrected EOF-only warning propagation across retained series; cumulative warnings remain bounded and known warnings survive reopening.
The Apache corpus retains upstream bytes, including three whitespace defects in
`subquery.test`; only that immutable fixture has a documented whitespace
exception, guarded by source identity checks.

## P1-08 verified HTTP slice

The [HTTP contract](specs/p1-08-prometheus-http.md) and
[handler guide](../internal/compat/promapi/QUERY.md) describe seven bounded read
APIs in query and all-in-one modes. Ingest mode retains its existing routes.
The fixed configured tenant is checked before storage access; supplied invalid
credentials never become anonymous reads. Native dispatch requires both the
capability and optional SPI interface; forced fallback and string results use
the pinned Prometheus engine. Reserved-label AST checks and output filtering,
inner selector windows, bounded catalog scans, result/JSON preflight, and
cancellation/Close ownership have regression coverage.

Fresh Go 1.27.1 checks with `GOFLAGS=-mod=readonly` after the warning and
slow-POST fixes passed all eleven gates:

- `make lint test`: vet/format and 20 race-enabled packages, including goleak
  checks for the HTTP handler and daemon.
- Both dependency scripts, including all five negative fixtures, and
  `go build ./...` passed.
- golangci-lint v2.14.0 returned zero issues for normal and integration scopes.
- The unchanged official float corpus passed 579 supported directives and
  6,296 actual engine queries; security and `go mod verify` passed.
- `go test -tags=integration -race -count=1 -v ./test/e2e` used the built daemon
  and real promtool 2.53.0 for instant/range value 42.5, catalog/auth/telemetry
  and clean SIGTERM, and retained real Prometheus remote_write, Vector
  none/gzip and telemetrygen HTTP/gRPC three-signal checks.
- The built-daemon smoke passed config-check, health/metrics, authenticated
  ingress and SIGTERM exit zero.

The metric-name existence probe now reads backend warnings before Close,
enforces cumulative count/byte caps across selectors, and emits one sanitized
warning. Regression tests cover empty and matching sets, exact and excess
warning limits, secret suppression and iterator/Close classification. Slow POST
cancellation joins its callback before sending the timeout response.

Only finite logical resources are bounded here; backend allocations, engine
memory and memory-driver retention are not RSS guarantees. Shutdown waits for
active handlers before closing the borrowed backend, so a backend that ignores
context cancellation can delay final shutdown indefinitely. ADR-017 documents
signed numeric timestamp rounding and the possible 1 ms upstream tie difference;
legacy `SecFloatToMilli` remains unchanged. Native histograms, multi-tenant
identity control plane, Grafana, persistent-driver/soak acceptance and deployment
remain outside this slice.

## Integrated P1-09 verification

Executed on Linux amd64 with Go 1.27.1 and readonly modules against the corrected
ClickHouse write implementation. Historical checkpoints above retain their original
results. The public SPI, other drivers and root workflows are unchanged.

| Exact command (from `platform/prism`) | Observed result |
| --- | --- |
| `GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly make lint test` | Formatting/vet and race suite passed in all 21 packages, including ClickHouse with goleak checks. |
| `scripts/check-dependencies.sh` and `scripts/test-dependency-guard.sh` | PASS; all five negative fixtures detected. |
| `go build ./...` and `go mod verify` | Both exit 0; all downloaded modules verified. |
| Pinned golangci-lint 2.14.0 `run --allow-serial-runners ./...` and `run --allow-serial-runners --build-tags=integration ./...` | Both `0 issues.` |
| `go test -race -count=1 -v ./test/promqltest -driver=memory` | Existing supported float PromQL corpus passed; native-histogram exclusions remain documented in P1-07. |
| `go test -race -count=1 -v ./test/security` | PASS. |
| `go test -tags=integration -race -count=1 -v ./test/e2e` with real Prometheus/promtool 2.53.0, Vector 0.45.0 and telemetrygen 0.116.0 | PASS through the existing memory daemon: remote_write, Loki none/gzip, OTLP HTTP/gRPC and Prometheus queries. |
| `python3 scripts/smoke-otlp.py --prismd <built binary> --telemetrygen <real client>` | Config/health/metrics/ingress smoke passed; SIGTERM exit 0. |
| `GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly python3 drivers/clickhouse/run-integration.py` | Pinned disposable ClickHouse 24.8.14.39: all 15 selected top-level tests and their subtests passed with race detection; own fixture cleaned. |
| Compiled graph from `go list -deps -test -json ./...`, original module licences and native client origin | 45 module/version/licence-file digests verified; [provenance inventory](dependencies-clickhouse.md) records actual notices including MIT-0. |

The real database tests cover eight exact template checksums, migration replay and
TTL reconciliation, drift rejection, exact three-signal/resource/Nested persistence,
tenant isolation and local/pending dependencies. Audit-driven regressions cover
all-zero IDs, UTF-8 metric identities, canonical materialized `labels_str`, UTC
retention boundaries that survive `OPTIMIZE FINAL`, all eight existing TTL sources
rejected before any TTL ALTER, configured INSERT server limits and fail-closed
column-order drift. Explicitly selected integration tests fail without a valid
native loopback fixture. The native adapter preserves deadlines and confirms the
server's physical column names before appending telemetry.

Default async query settings and a successful server async flush were observed;
this does not guarantee durability at acknowledgement. Writes remain nontransactional
and have no automatic retry. DDL retains the client timeout while the upstream
client derives its protocol server limit; controlled scans/INSERTs use an explicit
SQL cap. Drain other writers before retention changes. Metric series metadata has
no TTL (`Retention.Enforced=false`); production reads/runtime wiring and background
dependency reconciliation remain outside P1-09.

## P1-10 ClickHouse query and runtime

The [P1-10 contract](specs/p1-10-clickhouse-query.md) and
[ADR-019](sdd/13-ADR.md#adr-019p1-10-mandatory-query-與現有-spi-語義適配)
connect the existing ingestion pipeline and Prometheus query adapter to native
ClickHouse. Mandatory metric/log/trace reads retain the existing SPI time,
tenant and ordering contracts. Catalogs require actual retained observations;
regex/empty/absent matching follows the Go matcher. Streams own native rows and
connection admission until their lifetime ends. Server scans/results and decoded
logical results fail explicitly when bounded limits are exceeded.

Migration 009 adds persistent log write sequence order, and 010 adds UInt64 metric
value bits to preserve signed zero through the storage codec. Historical rows
derive bits from their stored Float64; previously lost signs cannot be recovered.
The original eight templates remain unchanged. Logs acknowledge synchronously to seed sequence after
a drained restart. Existing sequence-zero rows have deterministic content ties;
historical insertion order cannot be recovered. Independent writer processes
need external coordination. Metrics and traces retain configurable asynchronous
acknowledgement and its existing durability/partial-write limitations. The initial
sequence seed is a bounded scan and can fail closed when the retained table exceeds
the configured scan budget. Metric metadata has no TTL, so `Retention.Enforced`
remains false.

Daemon configuration uses a redacted DSN or bounded regular `dsn_file`, maps the
four retention settings into driver options and rejects conflicting options or
nonempty `storage.split`. `--config-check` validates without a database connection.
The optional capabilities remain undeclared; their existing conformance skips are
explicit, and no new known deviation or corpus exclusion is introduced.

Root verification on 2026-10-06 uses Go 1.27.1, readonly modules and native
ClickHouse 24.8.14.39 pinned by the runner image digest. These are new P1-10
measurements:

- `make lint test`: the complete normal suite passes race/goleak, memory
  conformance, the memory PromQL corpus and the existing security tests.
- `go test -tags=integration -race -count=1 -v -run '^TestClickHouse' ./drivers/clickhouse`:
  mandatory real-database conformance, C-MET-05, tenant/time/ordering, metadata
  holes and identity, full trace, iterator cancellation/drain and scan/result
  limits pass. Existing optional NativePromQL, log filter/stage pushdown, RED
  and Dependencies capability cases remain skipped; no mandatory check is skipped.
- The real-database full PromQL package passes all 12 original files, 579
  supported evaluations and 6,296 actual engine queries. All 189 original native
  histogram exclusions and the upstream hashes remain unchanged. All seven
  float round-trip fuzz seeds pass, including epoch negative zero.
- `go test -tags=integration -race -count=1 -v -run '^TestClickHouseDaemonCoreChain$' ./test/e2e`:
  the actual daemon accepts OTLP metrics, remote_write and Loki ingestion,
  persists to ClickHouse and answers authenticated PromQL instant/range and
  catalogs; persisted counts, tenant selection and SIGTERM drain pass.
- Pinned golangci-lint 2.14.0 reports zero issues for both normal and integration
  builds; integration `go vet`, dependency guards and five negative guard
  fixtures, native and CGO-disabled builds, and `go mod verify` pass. The current
  compiled dependency graph and license bytes are verified for 45 modules.
- Existing real Prometheus 2.53.0, promtool 2.53.0, Vector 0.45.0 and telemetrygen
  clients pass their ingestion/query gates. The daemon OTLP smoke also passes.

Retained failures include the first native result-overflow classification, codec
negative-zero loss, the historical pending-link fixture expiring under its real
one-day TTL, concurrent full corpus runs exceeding the Go default test timeout,
Docker 29.1.3 using a lowercase absence message after successful owned-fixture
removal, native caller context disabling the configured server memory cap, and
trace default-value preconditions diverging from the executable memory reference. Corrections retain the original assertions, corpus and exclusions.
The runner now gives the complete race corpus an explicit 20-minute Go timeout
and verifies cleanup with exact identity and absence checks; unknown Docker
errors still fail closed. Source-frozen independent review and the final owned
runner result are recorded with the change review before acceptance. Historical
P1-09 results above do not establish these P1-10 gates.

## Current integration boundary

P1-04 through P1-06 connect the existing atomic pipeline to authenticated OTLP,
remote_write v1 and Loki JSON/gzip push in the all-in-one and ingest roles. The [receiver design](specs/p1-04-otlp.md) and
[ADR-011](sdd/13-ADR.md#adr-011phase-1-otlp-寫入使用單租戶-file-backed-bearer)
record the initial single-tenant identity contract and original-unit partial
counts. The [pipeline contract](../internal/ingest/README.md) retains P1-03's
byte-admission cancellation point, delta replay guarantees, tenant lifecycle,
owned payloads, metadata capacity, finite retry and at-least-once writes.

Runtime capacity differs from standalone package defaults: one tenant, depth-4
priority queues, two workers per signal, 16 OTLP receiver slots and one separate
remote_write slot and one separate Loki slot.
Configuration validates a conservative logical budget before startup, including
compressed/decompressed receive buffers and serialized admission (1000 MiB at
defaults). This is not
an RSS limit: decoded protobuf/pdata, allocator/transient/state costs and memory-backend
retention remain additional. The standalone package's 5,808 MiB conservative
default allowance documented in P1-03 remains unchanged; daemon wiring does not
use that multi-tenant default.

Remaining integration work includes:

- Populate pipeline self-telemetry from ingestion events and translate bounded diagnostics to
  registry domains; package reports do not deliver alerts.
- Complete multi-tenant API-key/mTLS identity and live reload. Strict ingest and query
  currently fail closed, and headers cannot select another tenant.
- Expose the complete limits policy through configuration/control-plane APIs;
  only the four existing limits fields are wired in this milestone.
- Preserve trace truncation information across batches; already persisted spans
  cannot be retroactively changed by the limits package.
- Establish process-memory/soak evidence with a bounded persistent backend;
  logical configuration arithmetic is insufficient to claim production capacity.

## Remaining phases

P1-07 completes the float PromQL storage adapter and P1-08 adds the HTTP
query API. P1-09 adds ClickHouse migrations/writes and P1-10 connects reads and
daemon storage; P1-11 deployment is the next milestone. Phase 2 adds LogQL and alerting;
Phase 3 APM and alternate-driver proof; Phase 4 the agent; Phase 5 control plane,
security and operations. Differential and soak acceptance remain future work. Official float PromQL
corpus gates cover the memory and ClickHouse adapters; existing E2E and security checks cover
implemented ingestion and the adapter trust boundaries.

ClickHouse conformance and the daemon core chain have separate P1-10 gates. Grafana
datasource acceptance, complete-stack E2E, production soak, deployment and production
readiness remain unverified. Follow the [SDD task order](sdd/12-IMPLEMENTATION-PHASES.md).

## Go style reference

This section records the initial Go 1.23 adoption; the current baseline is noted below.

That delivery also consulted [JetBrains Modern Go Guidelines](https://github.com/JetBrains/go-modern-guidelines),
using its `use-modern-go` CLI v0.1.1 to resolve this component's `go.mod` (Go 1.23).
The inspected upstream checkout is `155dc7ca10da5e1f6c841503086957b1b37f5815`.
Review applies supported idioms such as integer range, `min`/`max`, `maps.Clone`,
`slices.Clone`/`Contains`/`SortFunc`, and `strings.Clone`; it preserves behavior and
context-cancellation checks where a shorthand would change them. The existing
`modernize` linter remains enabled. No Go language-version upgrade was included in that initial adoption.

The guideline CLI may require a newer toolchain to run; its own toolchain does
not change Prism's language target. At that checkpoint, final module checks used CI's Go 1.23.12.

### Current Go style baseline

The 2026-10-04 upgrade uses the same pinned Modern Go Guidelines CLI v0.1.1
with `list --go-version 1.27`; its full version-filtered list was reviewed.
Previous Go 1.23 references above describe the original adoption. Existing JSON
protocol behavior is preserved; upgrading the compiler does not authorize a
JSON v2 migration or an unrelated style rewrite.


## P1-11 root checkpoint — 2026-10-07 (not complete)

Go remains1.27.1 and clickhouse-go/v2 v2.48.0; no dependencies or public SPI
changed. The current deployment uses pinned Linux amd64 images and the existing
ClickHouse backend contract. Phase1 supports Prometheus datasource queries;
LogQL/Jaeger/alertmanager APIs and later dashboard panels remain inactive.

Fresh root `python3 drivers/clickhouse/run-integration.py` completed in
444.198 seconds, exit0. It runs real ClickHouse24.8.14.39 conformance, all12
PromQL corpus files with579 supported evaluations/6296 engine queries and
seven float round-trip seeds, then builds the actual daemon and verifies the
ClickHouse ingestion→PromQL core chain. All189 original native-histogram
exclusions and9 optional-capability conformance skips remain unchanged;
no mandatory check is skipped. Its exact owned fixture was removed.

Memory conformance/corpus, native race/goleak/vet/security/dependency guards,
normal/integration lint, readonly module verification, and the four actual
external-client integration tests have root evidence. Current compiled45module
versions and licence-file bytes match the approved graph. These are component
gates; they do not establish the complete Grafana stack's acceptance.

Root Compose attempt3 reaches healthy services and verifies telemetrygen's
three signals through both HTTP/gRPC, actual Prometheus remote_write, Vector
JSON push, native stored rows and direct PromQL/auth/catalog assertions.
Grafana's actual Prometheus datasource health then returns400 because its
fixed v12.0.0 probe uses `1+1` at Unix4. Its subsequent datasource query,
dashboard panel and restart assertions did not run. The minimal no-storage
instant-query scope exception awaits explicit approval; query code is unchanged.
All owned attempt3 resources and generated secrets were removed.

Earlier full real-database attempts failed during host ENOSPC; the tmpfs attempt
observed a complete float subtest pass but did not establish whole-suite/core
chain success because evidence writing failed. Those failures remain recorded;
the fresh successful root run above supplies the complete current component
gate. The earlier P1-10 promtool shutdown failure still has unknown cause; its
subsequent pass does not prove that residual intermittent risk has disappeared.
The current P1-11 has no complete frozen-source Astra review or merged delivery.


The root follow-up Compose run on2026-10-07 also confirms Grafana's live
`plugins.preinstall_disabled=true`, absence of all four suggested apps and
provisioning of four datasource definitions. Its health400 remains an overall
failure, with panel and restart checks unexecuted. A fresh standalone Buildx
build succeeds in45.662seconds, exit0; its actual nonroot image's version,
Go1.27.1/clickhouse-go2.48.0/CGO0 buildinfo and exported filesystem were verified.
The first verification wrapper misclassified Docker29's lowercase exact absence;
its failure remains and the strict corrected wrapper passes.

Root supplemented the native ClickHouse runner's container cleanup: the fixed
image declares an anonymous data volume. Exact mount/unmount fixture-ID events
and absence of all container references establish ownership before removal;
the fresh run's volume absence is verified. No broad volume/cache pruning was
used. Older unidentified resources remain preserved. These are component
checkpoint results, not complete Grafana E2E or approved query semantics.


## P1-11 final local acceptance — 2026-10-08

This dated result supersedes the preceding incomplete checkpoints without
rewriting their failures. The approved query exception uses the existing bounded
AST to identify storage-free expressions: only instant queries may bypass the
historical outer evaluation-time floor, and no storage-free expression dispatches
to a native storage querier. Data selectors, historical range/future/modifier,
authentication, tenant and resource bounds remain unchanged. GET/POST regressions
include arithmetic, vector/time/string, native-capability spies and rejection
cases. The original historical400 and mistaken native dispatch produced meaningful
Red before the implementation; final race/goleak and security checks pass.

A fresh pinned-image build passes with Go1.27.1, clickhouse-go/v2 v2.48.0,
CGO_ENABLED=0, nonroot execution and verified exported filesystem. The complete
`make e2e E2E_ARGS='…'` gate passes configuration validation, healthy services,
telemetrygen HTTP/gRPC three-signal storage, actual Prometheus remote_write and
Vector JSON push, native fields, PromQL/auth/catalog, Grafana datasource health,
42.5 proxy query and a real provisioned panel query. Both graceful daemon and
ClickHouse restarts retain the exact container and named-volume identities and
query-visible42.5 data. All owned containers, named volumes, network and generated
secrets are absent after cleanup. This is API-level evidence, not browser coverage.

The first new complete-stack attempt passed its main data/Grafana test but failed
at the unsupported Compose2.40.3 `start --wait`. The runner now uses supported
health-waiting `up --no-recreate --no-deps --no-build --pull never`, retains the
90second command bound and rejects identity/volume changes. The regression first
failed on the old route; root reran all Python runner/cleanup tests and the
whole actual Compose gate after correction. A second actual run exposed stale
ephemeral endpoints after same-container restart; an isolated Docker probe
confirmed port reassignment. The runner now re-reads current loopback endpoints
after each restart. No persistence assertion or timeout was waived.

Fresh root `make lint test`, `make deps-check`, normal/integration pinned lint and
vet, module verification, Go/CGO0 builds, four official-client integration tests
and daemon smoke pass. Memory and real ClickHouse conformance plus all12 corpus
files retain579 float evaluations,6296 engine queries,189 original native
histogram exclusions and7 round-trip seeds. The real database gate also passes
C-MET-05, cancellation/Close/tenant/time/sort/scan/result/error contracts and the
actual daemon core chain. Its9 optional-capability skips are explicit, not
mandatory passes. Root verifies its exact fixture container and associated
anonymous volume were removed; older unidentified resources remain untouched.

The module graph,45 compiled/test-module licence records and162 protected inputs
remain unchanged; all12 SDD22 artifact blocks match repository files. Earlier
ENOSPC, startup/configuration/health failures and the P1-10 unexplained first
promtool SIGTERM failure remain historical evidence. This acceptance does not
establish production capacity, arbitrary crash durability, Loki/Jaeger/alerting
query compatibility, release or production deployment.


### D016 independent-review correction

Independent frozen-source review found that invalid Docker endpoint or missing
Docker executable errors could leave generated secrets before the cleanup guard.
Main-level regressions reproduced that failure before correction. The runner now
guards fixture initialization and removes partial secrets on pre-start errors,
while retaining ownership-gated cleanup for started resources. Root reran the
Python runner/cleanup contracts and the complete actual Compose gate after the
fix; both passed, including both persistence restarts and exact cleanup. Earlier
review and failure evidence remain retained; corrected source/docs are frozen
for independent follow-up review.
