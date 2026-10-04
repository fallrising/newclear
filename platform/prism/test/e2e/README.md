# External-client acceptance

This focused integration gate runs the official telemetrygen process against
real loopback HTTP and gRPC listeners, the real receiver and ingest pipeline,
and the memory backend. It asserts stored values and tenant isolation through
SPI after flushing buffered records at shutdown. It does not test Grafana,
production drivers, deployment or process-memory limits.

From the Prism module directory, install the pinned tool outside the module:

```sh
GOTOOLCHAIN=go1.27.1 GOBIN=/tmp/prism-telemetrygen-v0.116.0 \
  go install github.com/open-telemetry/opentelemetry-collector-contrib/cmd/telemetrygen@v0.116.0
OTLP_TELEMETRYGEN_BINARY=/tmp/prism-telemetrygen-v0.116.0/telemetrygen \
  GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly \
  go test -tags=integration -race -count=1 -v -run TestTelemetrygen ./test/e2e
```

The build tag keeps external-process prerequisites separate from the normal unit
suite. Once selected, a missing generator is a failure, not a skip. All credentials
in this test are public test fixtures; do not reuse them outside local tests.
The tool installation does not alter Prism's module graph or Go version.

The executable daemon has a separate smoke probe. It generates a temporary
credential, checks configuration, base health/metrics, HTTP authentication for
all signals, a real gRPC export, and bounded SIGTERM exit without key disclosure:

```sh
GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly go build -o /tmp/prism-otlp-prismd ./cmd/prismd
python3 scripts/smoke-otlp.py --prismd /tmp/prism-otlp-prismd \
  --telemetrygen /tmp/prism-telemetrygen-v0.116.0/telemetrygen
```

## Real Prometheus remote_write

Use the official Prometheus v2.53.0 binary (matching the existing protocol-module
version) for a local acceptance process, not as a deployed service. Download the
platform archive and `sha256sums.txt` from the [official release](https://github.com/prometheus/prometheus/releases/tag/v2.53.0),
verify the archive against that checksum file, and extract the executable outside
this module. The Linux amd64 archive SHA256 is
`d9900a11e3c89261e6416e3c9989858bad7b206af8b6838dfe9a5392d8ddc60d`.

```sh
PROMETHEUS_BINARY=/tmp/prism-prometheus-2.53.0/prometheus \
  GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly \
  go test -tags=integration -race -count=1 -v -run TestPrometheusRemoteWrite ./test/e2e
```

The test starts a local exporter, the real receiver/pipeline/memory backend and
Prometheus. Its actual scrape/WAL/remote-write sender must persist `up=1` and
`prism_write_fixture=42.5`; an unrelated tenant must see nothing. The sender uses
a test-only bearer file, a one-shard bounded queue and retry-on-429. Processes,
listeners, storage and temporary files are closed by the test. There is no Prism
query endpoint involved: verification uses the existing SPI.

To run all external clients, set `PROMETHEUS_BINARY`,
`OTLP_TELEMETRYGEN_BINARY`, `VECTOR_BINARY`, `PROMTOOL_BINARY` and
`PRISMD_BINARY`, then omit `-run`. An explicitly selected gate fails
when its binary is missing; it does not silently skip. The daemon smoke above
also probes remote_write authentication, empty v1 admission and v2 rejection.

## Real Vector Loki JSON push

Download Vector 0.45.0 from the [official release](https://github.com/vectordotdev/vector/releases/tag/v0.45.0), verify its archive against `vector-0.45.0-SHA256SUMS`, and extract outside this module. The Linux x86_64 GNU archive SHA256 is `2d1076c4484222edd9bd1f566b3d395428cd7c934579f8f0301d04371c178e57`.

```sh
VECTOR_BINARY=/tmp/prism-vector-0.45.0/vector-x86_64-unknown-linux-gnu/bin/vector \
  GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly \
  go test -tags=integration -race -count=1 -v -run TestVectorLokiPush ./test/e2e
```

The actual Vector Loki sink sends two finite stdin events for each compression mode, `none` and `gzip`. The test checks JSON wire encoding, stored bodies, resource/trace/span metadata, trusted tenant isolation and process exit. Snappy implies protobuf in Vector and is outside this JSON milestone; configuring `encoding.codec` alone does not select JSON wire transport. Healthcheck is disabled because Loki query/ready compatibility is a later milestone. The test uses public local credentials and does not start a deployed collector. Missing VECTOR_BINARY is a failure when the integration suite is selected.

The daemon smoke also probes Loki authentication and a nonempty JSON push through the real executable, followed by clean SIGTERM. Persistence assertions belong to the SPI integration test.

## Real promtool HTTP queries

Use `promtool` from the same verified Prometheus v2.53.0 archive described above.
Build the daemon and run the actual client against an ephemeral all-in-one process:

```sh
GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly go build -o /tmp/prism-query-prismd ./cmd/prismd
PRISMD_BINARY=/tmp/prism-query-prismd \
  PROMTOOL_BINARY=/tmp/prism-prometheus-2.53.0/promtool \
  GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly \
  go test -tags=integration -race -count=1 -v -run TestPromtoolHTTPQuery ./test/e2e
```

The test writes an authenticated OTLP gauge, waits for asynchronous persistence,
and checks value 42.5 through real promtool instant and range queries. It also
checks authentication, reserved-label rejection, labels/series/metadata/buildinfo,
query self-telemetry and clean SIGTERM exit. Credentials are public test fixtures;
listeners, child processes and temporary files are local and bounded. Missing
executables fail the selected gate instead of skipping it. This is not Grafana
datasource, production driver or deployment acceptance.
