# Quickstart — Agent Platform

> Portfolio doc tier **A**. Full M1 local recipe:
> [M1.md § 本機執行](M1.md). Latest stop point: [HANDOFF.md](HANDOFF.md).
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

## Prerequisites

- Python **3.12**, Node **24.18.0**, Docker / Compose
- Run from `platform/agent-platform`
- KVM / Cocoon paths are separate; see [KVM-HOST.md](KVM-HOST.md)

## Minimal path (M1 loopback workbench)

```sh
cd platform/agent-platform
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
python -m pip install --no-deps -e .
npm --prefix web ci
cp .env.example .env
chmod 600 .env
# replace password placeholders in .env, then:
set -a && . ./.env && set +a
docker compose -f compose.m1.yml up -d --wait
agent-platform migrate
agent-platform bootstrap --username operator
```

Three terminals (venv + `.env` loaded):

```sh
agent-platform api --host 127.0.0.1 --port 8000
agent-platform worker
npm --prefix web run dev
```

Open `http://127.0.0.1:5173`. HTTP loopback only with the insecure-local opt-in
documented in M1.

## Verify

```sh
cd platform/agent-platform
make platform-check
make web-check
```

Real KVM gates need host hardware; treat as skipped without that environment.

## Authoritative longer docs

- [README](../README.md)
- [HANDOFF.md](HANDOFF.md), [M0.md](M0.md), [M1.md](M1.md), [M2.md](M2.md)
- [SDD.md](../SDD.md)
