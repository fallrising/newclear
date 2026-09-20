# ADR-0003 — Codex CLI pin is operator-supplied, not fanzloud 0.145.0

- Status: accepted
- Date: 2026-09-20
- Applies to: kith M5 sidecar (`products/kith/sidecar`)

## Context

`platform/fanzloud` pins official Codex CLI `0.145.0` for its Cloud/device-login fixtures. kith M5 runs the official CLI on the operator host via `sidecar.toml` `executable`. Copying that pin into kith would freeze an unrelated product's snapshot as if it were kith's forever version.

The operator already chooses the binary path. The sidecar must not vendor, download, or scrape an unofficial Codex/ChatGPT/Grok web client.

## Decision

- The operator supplies the **official Codex CLI** at an absolute `executable` path in `sidecar.toml`.
- kith documents that pin as **operator-configured**. It is not a repository-eternal version string.
- Do **not** treat fanzloud `0.145.0` as kith's pin, upgrade ceiling, or compatibility oracle.
- When the operator upgrades the CLI, they update the binary (and any local notes); kith does not ship a second unofficial protocol adapter to "keep up".
- Bot token remains `KITH_BOT_TOKEN` in the environment; it is not committed next to the pin.

## Consequences

- Tests use `sidecar/fake-cli.mjs`, never a real Codex login.
- INV-14 still requires that `executable` (whatever version the operator chose) is disjoint from `CODEBOX_CODEX_EXECUTABLE`.
- A future supported-release note may list a *currently* tested official version; that note is not a forever pin of `0.145.0`.
