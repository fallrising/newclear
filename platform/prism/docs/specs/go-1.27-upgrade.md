# Go 1.27 upgrade

## Goal and scope

Move Prism's supported development and CI baseline to Go 1.27.1, the current supported patch verified against the official release history on 2026-10-04. Earlier P1-02 through P1-05 acceptance remains historical Go 1.23 evidence. This maintenance milestone changes the language/toolchain baseline, not the ingest contracts or feature sequence.

## Version policy

Set `go 1.27.1` in go.mod: Go 1.27 language semantics with a minimum toolchain of 1.27.1. The go directive is the single source for both CI setup-go jobs via go-version-file. Set GOTOOLCHAIN=local in CI so the selected version is actually exercised. Developers can install 1.27.1 or use explicit GOTOOLCHAIN=go1.27.1; older toolchains with automatic switching disabled must report the minimum-version error. Do not add a redundant toolchain directive.

Use golangci-lint v2.14.0, verifying its official archive checksum and that its build toolchain supports Go 1.27. Keep enabled checks; only make necessary behavior-preserving compatibility corrections, independently reviewed. No wholesale style rewrite or global machine installation.

## Scope boundaries

Keep all require/replace directives and go.sum unchanged. No new runtime dependency, public SPI change, protocol behavior change, deployment, release or P1-06 work. Update active README/quickstart/external-client commands, current SDD baseline and sample version responses. Preserve previous verification commands/results and add a dated upgrade section rather than rewriting history.

There is no implemented deploy/Dockerfile.prismd yet. Update only SDD22's existing build recipe to golang:1.27.1-alpine; P1-11 still owns its implementation and container acceptance. Verify a CGO_ENABLED=0 static daemon build locally without claiming a container was built or deployed.

## Verification

Run Go 1.27.1 readonly make lint test (format/vet/race/goleak), dependency guard and all five negative cases, go build ./..., module graph comparison and go mod verify. Run the new pinned lint for normal and integration builds. Execute real Prometheus and telemetrygen external-client acceptance, security tests and executable daemon smoke. Check resulting binary build metadata, disabled-auto-switch older-toolchain rejection, and both CI jobs on this actual baseline. Targeted cancellation/shutdown stress covers the prior Go-upgrade probe's fixture correction.

A repeated shutdown run exposed a test fixture returning after its handler stopped but before net/http finished closing the connection. The incomplete-body fixture must preserve its original keep-alive request and wait for the server-side closed state during cleanup. Keep the forced-shutdown deadline and interrupted-body assertions; do not add sleeps, leak exclusions or change production shutdown behavior.

Independent exact-diff audit, actual PR/main CI success, remote source identity and ledger/handoff synchronization are required before completion. Performance gains are not claimed by compatibility tests.

References: [Go releases](https://go.dev/doc/devel/release), [toolchain selection](https://go.dev/doc/toolchain), [Go 1.27 notes](https://go.dev/doc/go1.27), [golangci-lint v2.14.0](https://github.com/golangci/golangci-lint/releases/tag/v2.14.0).
