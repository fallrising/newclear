# Quickstart — Eru VPS MVP

> Portfolio doc tier **A**. Live inventory, SSH keys, and provider state stay
> **private** (not in this public tree). Authoritative handoff:
> [HANDOFF.md](HANDOFF.md).
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

## Prerequisites

- Python 3 for `scripts/labctl.py` / preflight
- Private operator directory with inventory (gitignored / out-of-repo)
- Tailscale-connected lab hosts when doing live work

## Minimal path (local-only preflight)

From `labs/eru-vps-mvp`:

```sh
cd labs/eru-vps-mvp
python3 scripts/controller_preflight.py
python3 -m pytest -q
```

Preflight writes under ignored `private/controller-preflight/` when configured.

## Live path (operator)

Do **not** commit real inventory. Follow:

1. [HANDOFF.md](HANDOFF.md)
2. [OPERATOR.md](OPERATOR.md) / [RUNBOOK.md](RUNBOOK.md)
3. [CONTROLLED-REINSTALL.md](CONTROLLED-REINSTALL.md) for component reinstall

Example inventories in `examples/` are fictive addresses for planning only.

## Verify

```sh
cd labs/eru-vps-mvp
python3 -m pytest -q
```

Live nginx / reinstall evidence is operator-side; treat as skipped in CI-less
laptops without the lab.

## Authoritative longer docs

- [README](../README.md)
- [TASKS.md](TASKS.md)
- [SDD.md](SDD.md)
- [VALIDATION.md](VALIDATION.md)
