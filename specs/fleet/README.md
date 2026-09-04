# Fleet Catalog

Personal multi-VPS service catalog and thin control plane.

- **Contract:** `fleet.yaml` in each workload repo
- **Runtime:** Docker Compose (binaries wrapped in images)
- **Ingress:** Cloudflare Tunnel + Access — `public` / `access` / `private`
- **Orchestration:** outbound `fleet-agent` desired-state reconcile
- **Binaries:** `fleetd` (control plane), `fleet-agent` (node)

This is a Phase 1 MVP. The source of truth for protocols, schemas, and APIs is **[docs/SDD.md](docs/SDD.md)**.

## Status

Phase 1 code is on `main`. Unit tests run in GitHub Actions. Live VPS / Cloudflare bootstrap is operator-side — see [docs/bootstrap.md](docs/bootstrap.md).

```bash
make test
make build
make validate-schema
```

Binaries: `bin/fleetd`, `bin/fleet-agent` (`CGO_ENABLED=0`). Images: `make image-fleetd` / `make image-agent`.

First node: [docs/bootstrap.md](docs/bootstrap.md) (WARP Split Tunnel + delete Local Domain Fallback).

## Scale

Designed for 2–10 pet VPS, 5–40 services, one operator. Not Kubernetes.

## Quick pointers

| Doc | What |
| --- | --- |
| [docs/SDD.md](docs/SDD.md) | Software design document |
| [docs/bootstrap.md](docs/bootstrap.md) | First-node / WARP checklist |
| `examples/hello-healthz` | Minimal `/healthz` workload |
| `contrib/github-actions/deploy.yml` | Copy into a workload repo |

## Adjacent tools (not this repo)

- [`vps-hygiene`](https://github.com/fallrising) — host inventory/cleanup. Fleet does not exec those scripts.
- [`clarkQ`](https://github.com/fallrising/clarkQ) — application queue. Never the fleet control bus.

## License

Apache-2.0
