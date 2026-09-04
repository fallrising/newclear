# AGENTS.md — pi-platform-demo

This repo demonstrates using Pi as a VPS platform scaffolder.

## Priority

1. Prefer the `platform-bootstrap` skill for any infra generation request
2. Prefer editing files under `platform/` over inventing a new layout
3. Prefer Docker Compose over installing host packages
4. Prefer the official `decolua/9router` image for LLM routing — do not vendor 9router source
5. Never commit API keys; configure LLM providers in the 9router dashboard
6. Never run destructive docker commands (`down -v`, `volume rm`) unless the user explicitly asks

## Project shape

- `.pi/skills/` — Pi skills (recipes)
- `scripts/bootstrap-platform.sh` — deterministic generator Pi should call
- `platform/` — generated infrastructure (source of truth after bootstrap)
- `platform/clients/` — Pi / OpenCode wiring templates for the 9router gateway

## Language

Answer the user in the same language they use. Default to Traditional Chinese if mixed.
