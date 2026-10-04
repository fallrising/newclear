# Prism

> **Portfolio doc tier: A (active development)** — Development resumed on
> 2026-10-03. [Portfolio](../../PORTFOLIO.md) ·
> [Documentation policy](../../docs/portfolio-doc-tiers.md).

Prism is building a storage-pluggable observability compatibility layer for
metrics, logs, traces, and alerting. Its design accepts standard telemetry
protocols and exposes Prometheus, Loki, Jaeger, and Alertmanager-compatible APIs
behind a public Go storage SPI.

**Status:** UTM/SPI, the memory driver, normalization, per-tenant limits and a
bounded asynchronous pipeline are implemented. P1-04 connects authenticated OTLP
metrics/logs/traces over HTTP and gRPC to the all-in-one and ingest daemon roles.
P1-05 adds authenticated Prometheus remote_write v1 on the same HTTP listener.
The initial runtime supports a single configured tenant and file-backed bearer
key. Compatible query APIs, production drivers, alerting, agent and console
remain unimplemented; this is not yet a complete APM service.

## Start here

- [Development quickstart](docs/quickstart.md): tests and authenticated local OTLP/remote_write ingestion.
- [Code and documentation inventory](docs/inventory.md): implementation evidence,
  known gaps, and the next integration boundary.
- [SDD](docs/sdd/README.md) and [task sequence](docs/sdd/12-IMPLEMENTATION-PHASES.md).

## Repository layout

- `pkg/utm` and `pkg/spi`: telemetry model and storage contracts.
- `drivers/memory`: the implemented reference backend.
- `internal/config`, `secret`, `server`, `telemetry`: supporting packages.
- `internal/ingest/normalize`: protocol-to-UTM normalization and bounded delta state.
- [`internal/ingest`](internal/ingest/README.md): bounded pipeline,
  tenant lifecycle, atomic admission, owned batches, retries and shutdown.
- [`internal/ingest/limits`](internal/ingest/limits/README.md): verified per-tenant
  quotas, bounded cardinality tracking, record limits and byte admission.
- `internal/compat/otlp`: bounded HTTP/gRPC receivers and protocol-native responses.
- `internal/compat/promapi`: bounded snappy/protobuf remote_write v1 receiver.
- `cmd/prismd`: health/metrics plus OTLP and remote_write in ingest roles; `prism-agent` and `prismctl` remain placeholders.
- `docs/sdd`: implementation contracts; `docs/adr`: architecture decisions.

The Go module is `github.com/fallrising/newclear/platform/prism`.
The supported baseline is Go 1.27.1; CI reads that minimum directly from
`go.mod`. See the [upgrade contract](docs/specs/go-1.27-upgrade.md).

## Constraints

- LogQL is clean-room work. Do not import or copy AGPL Loki/Tempo/Grafana code.
- Telemetry data is not backed up by default; durability belongs to the storage
  layer. PostgreSQL metadata and Git-managed configuration are planned recovery sources.
- Production availability requires an external watchdog receiver independent of Prism.

## Verification

From this directory:

```sh
make lint test
scripts/check-dependencies.sh
scripts/test-dependency-guard.sh
go build ./...
```

`make lint` checks formatting and runs `go vet`; `make test` runs the suite with
`-race`. The repository-root [Prism CI](../../.github/workflows/prism-ci.yml)
also runs `golangci-lint` v2.14.0 as a separate job.

New Go code is reviewed against the version-specific
[JetBrains Modern Go Guidelines](https://github.com/JetBrains/go-modern-guidelines),
with `platform/prism/go.mod` as the language-version boundary. The `modernize`
linter checks supported modernization opportunities; see the
[inventory](docs/inventory.md#go-style-reference) for the reference and verification details.

The [external-client acceptance gate](test/e2e/README.md) runs pinned telemetrygen
against both transports and verifies stored data through SPI. The
[P1-04 contract](docs/specs/p1-04-otlp.md) describes authentication, partial success,
capacity and shutdown. Logical memory budgeting is not a hard RSS limit, and the
memory backend has unbounded retention.

The [P1-05 contract](docs/specs/p1-05-remote-write.md) defines remote_write headers,
finite decode work, trusted identity and retry behavior. Its external-client test
runs real Prometheus and verifies persisted samples and isolation through SPI.
