# OTLP external-client acceptance

This focused integration gate runs the official telemetrygen process against
real loopback HTTP and gRPC listeners, the real receiver and ingest pipeline,
and the memory backend. It asserts stored values and tenant isolation through
SPI after flushing buffered records at shutdown. It does not test Grafana,
production drivers, deployment or process-memory limits.

From the Prism module directory, install the pinned tool outside the module:

```sh
GOTOOLCHAIN=go1.23.12 GOBIN=/tmp/prism-telemetrygen-v0.116.0 \
  go install github.com/open-telemetry/opentelemetry-collector-contrib/cmd/telemetrygen@v0.116.0
OTLP_TELEMETRYGEN_BINARY=/tmp/prism-telemetrygen-v0.116.0/telemetrygen \
  GOTOOLCHAIN=go1.23.12 GOFLAGS=-mod=readonly \
  go test -tags=integration -race -count=1 -v ./test/e2e
```

The build tag keeps external-process prerequisites separate from the normal unit
suite. Once selected, a missing generator is a failure, not a skip. All credentials
in this test are public test fixtures; do not reuse them outside local tests.
The tool installation does not alter Prism's module graph or Go version.

The executable daemon has a separate smoke probe. It generates a temporary
credential, checks configuration, base health/metrics, HTTP authentication for
all signals, a real gRPC export, and bounded SIGTERM exit without key disclosure:

```sh
GOTOOLCHAIN=go1.23.12 GOFLAGS=-mod=readonly go build -o /tmp/prism-otlp-prismd ./cmd/prismd
python3 scripts/smoke-otlp.py --prismd /tmp/prism-otlp-prismd \
  --telemetrygen /tmp/prism-telemetrygen-v0.116.0/telemetrygen
```
