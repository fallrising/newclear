---
id: P06
title: First-rollout readiness preflight
status: done
revision: 2
baseline_commit: 4721ed72f1398f1698980725ec1e98786eaa2f9d
depends_on:
  - P05 versioned single-VPS deployment bundle
allowed_paths:
  - .github/workflows/deploy.yml
  - ops/rollout-preflight.sh
  - tests/ops/**
  - README.md
  - WORK_LOG.md
  - docs/CI_CD_RUNBOOK.md
  - docs/TECH_SPEC.md
  - docs/sdd/**
forbidden_paths:
  - ops/compose.yml
  - ops/deploy.sh
  - backend/**
  - frontend/**
---

# P06 — First-rollout readiness preflight

## Problem and context

P05 provides an immutable, health-gated VPS deployment bundle, but the first
real rollout is still unsafe to enable without evidence about the target host,
DNS, Traefik, GHCR access, rollback image, and operator window. Those values
are not present in the repository and must not be invented.

P06 adds a read-only, host-local preflight and a reproducible local Docker
rehearsal. It closes the repository readiness gap while leaving the first live
VPS deployment as a separate, explicitly authorized external operation.

## Goal

An operator can prove that a candidate release and rollback SHA are usable on
the intended host before enabling deployment. Repository tests prove that the
preflight fails closed and cannot mutate Docker or start a deployment.

## Scope

- A versioned `ops/rollout-preflight.sh` intended to run from a reviewed
  checkout on the target host.
- Hermetic tests for validation, command ordering, failure propagation, and
  non-mutation.
- A local Docker rehearsal of the P05 runtime, health, hardening, and SQLite
  replacement behavior.
- Operator documentation for the remaining SSH, GitHub, DNS, smoke, and
  rollback gates.

## Non-goals

- Contacting, provisioning, or changing a real VPS.
- Creating DNS records, certificates, Docker networks, users, or directories.
- Installing the bundle, logging in to GHCR, or changing package visibility.
- Creating GitHub secrets, environments, variables, or repository settings.
- Setting `DEPLOY_ENABLED=true` or invoking `ops/deploy.sh`.
- Claiming a live deployment, public HTTPS success, or end-to-end GitHub
  Actions deployment without external evidence.
- Automated rollback, backup, zero downtime, or Traefik reconfiguration.

## Inputs and prerequisites

The host-local preflight accepts exactly:

```text
rollout-preflight.sh twitter-deck <release-full-sha> <rollback-full-sha>
```

It requires these non-secret environment values:

| Name | Meaning |
|---|---|
| `APP_HOST` | Formal lowercase DNS hostname routed by Traefik |
| `EXPECTED_DNS_IPV4` | Exact VPS IPv4 expected from DNS-only resolution |
| `TRAEFIK_CONTAINER` | Exact running Traefik container name |

The following path overrides exist only for hermetic tests:

| Name | Production default |
|---|---|
| `OBECHOW_SOURCE_ROOT` | Repository root containing reviewed `ops/` files |
| `OBECHOW_DEPLOY_ROOT` | `/srv/apps` |
| `OBECHOW_DEPLOY_SCRIPT` | `/srv/deploy.sh` |

All path overrides must be absolute and are used only as quoted data.

## Functional requirements

### P06-FR-01 — Validate every operator input first

- Require exactly three arguments.
- Accept only the literal application name `twitter-deck`.
- Require distinct release and rollback values, each exactly 40 lowercase
  hexadecimal characters.
- Require a lowercase DNS hostname with valid label boundaries and length.
- Require a syntactically valid IPv4 address with every octet in `0..255`.
- Require a container name that begins with an alphanumeric character and
  otherwise contains only letters, digits, `_`, `.`, and `-`.
- Reject invalid input before invoking Docker, DNS lookup, or file comparison.

### P06-FR-02 — Prove the installed bundle is reviewed

- Require the application directory, installed Compose file, and installed
  executable deploy entrypoint.
- Byte-compare the installed Compose file with `ops/compose.yml` from the
  reviewed checkout.
- Byte-compare `/srv/deploy.sh` with the reviewed `ops/deploy.sh`.
- Fail before host capability or registry checks on any mismatch.

### P06-FR-03 — Prove Docker and Compose capability

- Require access to a responding Docker Engine.
- Require Docker Compose v2 to respond.
- Require `docker compose up` to advertise the `--wait` capability used by
  P05.
- Resolve the installed Compose model for the exact release SHA and `APP_HOST`.
- Require the resolved service list to be exactly `app`.
- Require the resolved image list to be exactly
  `ghcr.io/fallrising/obechow:<release-full-sha>`.

### P06-FR-04 — Prove edge and Traefik prerequisites

- Require the external network lookup to resolve exactly `edge`.
- Require the named Traefik container to be running and attached to `edge`.
- Require its running command to contain an ACME configuration for the exact
  resolver name `le`, matching the P05 router labels and runbook.

### P06-FR-05 — Prove DNS and immutable images

- Require `APP_HOST` DNS A-record resolution to contain
  `EXPECTED_DNS_IPV4`.
- Require read-only manifest inspection to succeed for both the release and
  rollback full-SHA GHCR images.

### P06-FR-06 — Report without mutation

- On success, report the exact app, release SHA, rollback SHA, and hostname,
  followed by an explicit statement that no deployment occurred.
- On failure, exit non-zero, omit the success message, and stop before every
  later check.
- Never invoke the deploy entrypoint, `docker compose pull/up/down`, Docker
  login/logout, network create/remove, prune, or any other state-changing
  Docker operation.

## Security and operational invariants

- `DEPLOY_ENABLED` remains absent or exactly `false`; P06 code never reads or
  changes it.
- No secret, SSH key, token, credential, production IP, or real hostname is
  committed or printed.
- Inputs are data, never shell fragments: no `eval`, command construction, or
  unquoted expansion.
- GHCR checks use immutable full-SHA references and `docker manifest inspect`;
  `latest` is never accepted.
- All checks are read-only and failure-closed.
- File identity precedes Docker, DNS, and registry access.
- Release and rollback images must both exist before an operator can proceed.
- A local Docker rehearsal is evidence about the repository bundle only; it is
  never evidence about VPS, DNS, TLS, SSH, secrets, or GitHub settings.

## BDD scenarios

### P06-BDD-01 — Ready host passes without deployment

**Given** reviewed artifacts are installed, Docker/Compose and Traefik meet the
contract, DNS points to the expected address, and both immutable images exist

**When** the preflight checks a release and rollback SHA

**Then** every read-only check runs in order, the exact values are reported,
and no deployment or Docker mutation occurs.

### P06-BDD-02 — Malicious or malformed input is isolated

**Given** wrong arity, an unknown app, mutable/uppercase/shell-like SHAs, an
invalid hostname/IP/container, or a relative override path

**When** preflight validation runs

**Then** it exits non-zero before Docker, DNS, registry, or comparison commands
run.

### P06-BDD-03 — Artifact drift stops host access

**Given** the installed Compose or deploy file differs from the reviewed copy

**When** preflight compares the bundle

**Then** it exits non-zero before Docker, DNS, or registry access.

### P06-BDD-04 — A failed prerequisite stops later checks

**Given** any Docker, Compose, edge, Traefik, DNS, Compose-model, or manifest
check fails

**When** preflight runs

**Then** the failure propagates, no later command runs, and no success message
is printed.

### P06-BDD-05 — Local replacement preserves data

**Given** the production image and P05 Compose runtime are started on an
isolated local Docker network

**When** a post is created and the app container is force-recreated

**Then** the replacement becomes healthy, retains the post in bind-mounted
SQLite, and retains the read-only/no-new-privileges/tmpfs hardening.

## Acceptance criteria

- `bash -n` passes for every added or changed shell script.
- Hermetic tests cover all five BDD scenarios and assert exact command logs,
  exact stop points, output values, and absence of mutations.
- The preflight tests run before the production image build on pull requests
  and `main`.
- The existing 42 P05 deployment assertions remain green.
- Real Compose resolution passes.
- A local Docker image and isolated-network replacement rehearsal proves
  health, persistence, and runtime hardening.
- `actionlint .github/workflows/deploy.yml` and `git diff --check` pass.
- The runbook lists the exact external evidence required before a live
  rollout and keeps `DEPLOY_ENABLED=false`.
- Verification records local and GitHub evidence without claiming a VPS
  deployment.

## Rollback plan

The repository change is additive and can be reverted normally. It does not
change the accepted P05 Compose or deploy entrypoint and performs no external
mutation. Test containers and networks are project-scoped and removed only if
the rehearsal created them. Live rollback remains the P05 command with the
preflight-verified rollback full SHA.

## Evidence requirements

Repository completion requires:

- delegated diff and main-agent finding disposition;
- exact hermetic test counts and commands;
- Compose, shell, workflow, whitespace, and probable-secret checks;
- local Docker build ID plus health, hardening, and persistence observations;
- pull-request and merged-main GitHub Actions results.

Live activation is a later external gate and additionally requires:

- authorized SSH host, port, user, key, and trusted host fingerprint;
- formal `APP_HOST`, DNS evidence, and VPS public IP;
- running Traefik `edge` attachment and `le` resolver evidence;
- release and rollback GHCR pull authorization;
- GitHub secrets/environment access and `DEPLOY_ENABLED` state;
- a named operator, maintenance/rollback window, exact smoke steps, and online
  HTTPS/API/data-persistence evidence.
