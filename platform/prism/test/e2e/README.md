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

To run both external clients, set both `PROMETHEUS_BINARY` and
`OTLP_TELEMETRYGEN_BINARY`, then omit `-run`. An explicitly selected gate fails
when its binary is missing; it does not silently skip. The daemon smoke above
also probes remote_write authentication, empty v1 admission and v2 rejection.
