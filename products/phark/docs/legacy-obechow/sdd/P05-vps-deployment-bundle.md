---
id: P05
title: Versioned single-VPS deployment bundle
status: done
revision: 1
baseline_commit: ca66162
depends_on:
  - P04 GitHub Actions image publication
allowed_paths:
  - .github/workflows/deploy.yml
  - ops/**
  - tests/ops/**
  - README.md
  - WORK_LOG.md
  - docs/CI_CD_RUNBOOK.md
  - docs/TECH_SPEC.md
  - docs/sdd/**
forbidden_paths:
  - backend/src/**
  - frontend/src/**
---

# P05 — Versioned single-VPS deployment bundle

## Goal

Turn the previously inline VPS examples into a versioned, testable deployment
bundle. An operator can install the bundle on the target host, while GitHub
Actions can request an exact, health-gated release without accepting arbitrary
application names or mutable image tags.

## Inputs and prerequisites

- P04 publishes `ghcr.io/fallrising/obechow:<full-git-sha>`.
- P04 invokes `/srv/deploy.sh twitter-deck <full-git-sha>`.
- The VPS already has Docker Engine with Compose v2 and an external `edge`
  network shared with Traefik.
- The app directory is `/srv/apps/twitter-deck`; tests may override its parent
  with `OBECHOW_DEPLOY_ROOT`.
- `APP_HOST` is operator-owned configuration and is never hard-coded to a real
  production hostname.

## Delivery contract

| Surface | Contract |
|---|---|
| Image | Deploy only `ghcr.io/fallrising/obechow:<40-lowercase-hex-sha>` |
| Entrypoint | Accept exactly `twitter-deck <sha>` and reject every other shape before Docker runs |
| Preflight | Validate the resolved Compose model before pulling or recreating |
| Release | Pull only the `app` service, recreate only that service, and wait for health |
| Failure | Return non-zero and never print a success message when validation, pull, or health fails |
| Persistence | Bind `./data` to `/data`; keep SQLite outside the container lifecycle |
| Ingress | Join external `edge`; expose no host port; configure Traefik from required `APP_HOST` |
| Hardening | Use `no-new-privileges`, a read-only root, noexec general `/tmp`, a bounded executable SQLite-only tmpfs, and bounded logs |
| Scope | Never prune images or mutate unrelated Docker services, networks, or volumes |

The immutable SHA restriction is deliberate. `latest` remains a publication
convenience, not a production deployment input.

## BDD scenarios

### P05-BDD-01 — Valid immutable deployment

**Given** the app directory contains valid operator configuration and Compose
state

**When** `/srv/deploy.sh twitter-deck <40-lowercase-hex-sha>` runs

**Then** it validates Compose, pulls `app`, starts only `app`, waits for the
health check, and reports the exact deployed SHA.

### P05-BDD-02 — Invalid input has no Docker side effect

**Given** an unknown app, missing argument, uppercase SHA, short SHA, tag name,
or shell-like input

**When** the deploy entrypoint validates its arguments

**Then** it exits non-zero before invoking Docker.

### P05-BDD-03 — Health failure is a deployment failure

**Given** Compose cannot make `app` healthy within the bounded wait

**When** the release command returns non-zero

**Then** the script returns non-zero and does not print a deployed message.

### P05-BDD-04 — Persistent, private service

**Given** the Compose model resolves successfully

**When** an operator inspects the model

**Then** SQLite data is bind-mounted, no host port is published, and Traefik
routes the required hostname over the external `edge` network.

### P05-BDD-05 — Bounded production scope

**Given** a valid release request

**When** its command sequence is inspected

**Then** it targets only the `app` service and contains no image prune, volume
removal, network creation, or unrelated project mutation.

## Acceptance criteria

- `bash -n` passes for deployment and test scripts.
- Real `docker compose config --quiet` passes with the example environment.
- Automated shell tests cover every BDD scenario and run in both pull-request
  validation and main publication jobs before an image build.
- A local container smoke test proves the image health command works with the
  read-only root filesystem and writable `/tmp`.
- `actionlint` and `git diff --check` pass.
- The runbook documents installation, required variables, first activation,
  normal deployment, rollback, and what is still an external operator gate.
- No hostname, registry credential, private key, token, or VPS mutation is
  committed or performed by this node.

## Non-goals

- Provisioning Docker, Traefik, DNS, TLS, the VPS filesystem, or GitHub secrets.
- Enabling `DEPLOY_ENABLED` or performing the first live SSH deployment.
- Automated rollback, zero-downtime replacement, database backup, or retention
  management for old images.
- Supporting arbitrary applications through the deploy entrypoint.
