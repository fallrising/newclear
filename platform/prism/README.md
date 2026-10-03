# Prism

> **Portfolio doc tier: A (active development)** — Development resumed on
> 2026-10-03. [Portfolio](../../PORTFOLIO.md) ·
> [Documentation policy](../../docs/portfolio-doc-tiers.md).

Prism is building a storage-pluggable observability compatibility layer for
metrics, logs, traces, and alerting. Its design accepts standard telemetry
protocols and exposes Prometheus, Loki, Jaeger, and Alertmanager-compatible APIs
behind a public Go storage SPI.

**Status:** UTM/SPI contracts, the memory driver, configuration, HTTP lifecycle,
secret redaction, a self-telemetry registry, and P1-01 normalization exist.
P1-02 ingest limits are verified as a standalone package; P1-03 pipeline
integration is the next task. The daemon currently
serves health and Go/process metrics only: telemetry receivers, the write/query
pipeline, production drivers, alerting, agent, and console are not connected.
Prism is not yet a usable APM service.

## Start here

- [Development quickstart](docs/quickstart.md): tests and the local HTTP skeleton.
- [Code and documentation inventory](docs/inventory.md): implementation evidence,
  known gaps, and the next integration boundary.
- [SDD](docs/sdd/README.md) and [task sequence](docs/sdd/12-IMPLEMENTATION-PHASES.md).

## Repository layout

- `pkg/utm` and `pkg/spi`: telemetry model and storage contracts.
- `drivers/memory`: the implemented reference backend.
- `internal/config`, `secret`, `server`, `telemetry`: supporting packages.
- `internal/ingest/normalize`: protocol-to-UTM normalization and bounded delta state.
- [`internal/ingest/limits`](internal/ingest/limits/README.md): verified per-tenant
  quotas, bounded cardinality tracking, record limits and byte admission.
- `cmd/prismd`: the runnable HTTP skeleton; `prism-agent` and `prismctl` remain placeholders.
- `docs/sdd`: implementation contracts; `docs/adr`: architecture decisions.

The Go module is `github.com/fallrising/newclear/platform/prism`.

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
also runs `golangci-lint` v2.12.2 as a separate job.

New Go code is reviewed against the version-specific
[JetBrains Modern Go Guidelines](https://github.com/JetBrains/go-modern-guidelines),
with `platform/prism/go.mod` as the language-version boundary. The `modernize`
linter checks supported modernization opportunities; see the
[inventory](docs/inventory.md#go-style-reference) for the reference and verification details.
