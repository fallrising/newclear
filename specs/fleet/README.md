# Fleet Catalog

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: B (maintain / public contract)** — Keep the contract usable; do not expand into a second product line without an owner override. Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


Personal multi-VPS service catalog and thin control plane.

- **Contract:** `fleet.yaml` in each workload repo
- **Runtime:** Docker Compose (binaries wrapped in images)
- **Ingress:** Cloudflare Tunnel + Access — `public` / `access` (current path: Access web)
- **Orchestration:** outbound `fleet-agent` desired-state reconcile
- **Binaries:** `fleetd` (control plane), `fleet-agent` (node)

This is a Phase 1 MVP. The source of truth for protocols, schemas, and APIs is **[docs/SDD.md](docs/SDD.md)**.

## Monorepo path note

This tree lives under `specs/fleet` for historical migration reasons, but it is an **implementable control-plane component** (Go binaries, Compose, CI), not monorepo documentation. Root `docs/` is for portfolio policy only. See [taxonomy](../../docs/taxonomy.md).

## Status

Owner scope (2026-10-23): support only `public` and `access`; current deployments use Access web login. Public mode is retained but unused. See the [database upgrade notes](docs/bootstrap.md#database-upgrade) before upgrading existing state.

The 2026-10-23 candidate fixes schema/Compose compilation and agent recovery. Native checks and an isolated real-Docker VPS lifecycle run have passed; see [the acceptance record](docs/evidence/2026-10-23-acceptance.md) and [task board](docs/tasks/BOARD.md). Real Cloudflare Access web login acceptance remains pending, so this is not a fully accepted usable release.

[Root Fleet CI](../../.github/workflows/fleet-ci.yml) now defines the monorepo check entrypoint; the historical nested workflow does not run as a root workflow. The [task board](docs/tasks/BOARD.md) records PR, CI and merge status for this milestone. Cloudflare bootstrap remains operator-side — see [docs/bootstrap.md](docs/bootstrap.md).

```bash
make test
make build
make validate-schema
```

In the shared agent workspace, use `scripts/verify.py` through the common launcher. It runs the same Go test/vet/schema/build gates, adds the hello-healthz binary for acceptance, and places logs and binaries in the launcher's evidence/artifact directories. `scripts/acceptance.py` runs only on a preflighted isolated Docker host and preserves state/evidence; it does not test Cloudflare. See [bootstrap](docs/bootstrap.md#isolated-lifecycle-and-recovery-acceptance).

Binaries: `bin/fleetd`, `bin/fleet-agent` (`CGO_ENABLED=0`). Images: `make image-fleetd` / `make image-agent`.

First node: [docs/bootstrap.md](docs/bootstrap.md) (browser email OTP and explicit allowlist).

## Scale

Designed for 2–10 pet VPS, 5–40 services, one operator. Not Kubernetes.

## Quick pointers

| Doc | What |
| --- | --- |
| [docs/SDD.md](docs/SDD.md) | Software design document |
| [docs/bootstrap.md](docs/bootstrap.md) | First-node / Access web checklist |
| `examples/hello-healthz` | Minimal `/healthz` workload |
| `contrib/github-actions/deploy.yml` | Copy into a workload repo |

## Adjacent tools (not this repo)

- [`vps-hygiene`](https://github.com/fallrising) — host inventory/cleanup. Fleet does not exec those scripts.
- [`clarkQ`](https://github.com/fallrising/newclear/systems/clarkq) — application queue. Never the fleet control bus.

## License

Apache-2.0
