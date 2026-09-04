---
task_id: P05-T01
node_id: P05
title: Implement the production Compose and deploy bundle
status: done
owner: opencode
reviewer: codex
depends_on:
  - P05 specification baseline
allowed_paths:
  - ops/compose.yml
  - ops/.env.example
  - ops/deploy.sh
---

# P05-T01 — Production bundle

## Objective

Implement the smallest production bundle that satisfies P05-BDD-01 through
P05-BDD-05. Treat the node spec as the authority.

## Required implementation

- Compose must require a tag and hostname, persist `/data`, join external
  `edge`, expose only Traefik labels, define a health check, and apply the
  specified runtime hardening.
- The deploy script must accept exactly two arguments, validate the literal app
  and full lowercase SHA before Docker, run from the fixed app directory, then
  execute the scoped preflight/pull/health-wait sequence.
- Error messages must be actionable without echoing secrets.
- Files must be ready to copy to the paths documented in the implementation
  plan.

## Constraints

- Do not add installation side effects or contact Docker registries/VPS hosts.
- Do not accept `latest`, arbitrary apps, or arbitrary paths.
- Do not run image prune or any destructive/global Docker command.
- Do not commit, push, or edit files outside the allowed paths.

## Handoff evidence

- List changed files.
- Report `bash -n ops/deploy.sh`.
- Report a real Compose config check using the example environment.
- Call out any assumption or unverified behavior.
