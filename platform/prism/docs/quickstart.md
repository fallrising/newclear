# Prism development quickstart

This exercises the existing local HTTP skeleton with the memory backend. It does
not accept telemetry or expose the planned compatible query APIs. The fixture
configuration and fixture credentials are for loopback development only.

## Prerequisites

Go 1.23+, a C compiler for race tests, and Bash. Run commands from
`platform/prism`. Initial module/toolchain download requires network access.

## Verify the source

```sh
make lint test
scripts/check-dependencies.sh
scripts/test-dependency-guard.sh
go build ./...
```

These commands passed on the inventoried baseline with Go 1.23.0 and on the
integrated P1-02 delivery with `GOTOOLCHAIN=go1.23.12` on Linux amd64
(12 race-tested packages).
See [inventory](inventory.md) for the scope and remaining acceptance gaps.

## Check configuration

```sh
go run ./cmd/prismd --config internal/config/testdata/prismd.yaml --config-check
```

Expected: `prismd: configuration valid`. The fixture selects `memory` and binds
HTTP to `127.0.0.1:9090`. The production `deploy/prismd.yaml` is not present yet;
the default storage selection is ClickHouse, whose driver is not implemented.

## Start and inspect

```sh
go build -o /tmp/prism-dev-prismd ./cmd/prismd
/tmp/prism-dev-prismd --config internal/config/testdata/prismd.yaml
```

In another terminal:

```sh
curl --fail http://127.0.0.1:9090/-/healthy
curl --fail http://127.0.0.1:9090/metrics
```

Health returns `ok`; metrics expose Go/process collectors. The Prism-specific
telemetry registry is implemented separately but is not wired into this daemon.
Stop the foreground process with Ctrl-C; SIGTERM is also handled gracefully.
If 9090 is busy, set `PRISM_SERVER_HTTP_LISTEN=127.0.0.1:19090` for the start
command and use that port for the probes.

The same build/configuration/start/HTTP/SIGTERM path was tested using an ephemeral
loopback port and a Python HTTP client: both endpoints returned 200 and SIGTERM
exited with status 0. The documented `curl --fail` probes also passed against a Go 1.23.12 build on
an ephemeral loopback port.

## Integration boundary

SDD [P1-03](sdd/12-IMPLEMENTATION-PHASES.md) adds the ingest pipeline after the
limits package. Tenant configuration, receiver status mapping, telemetry report
consumption and alert delivery require later integration. Do not expose this
skeleton as a production receiver.
