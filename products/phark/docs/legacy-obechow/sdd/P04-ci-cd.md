---
id: P04
title: GitHub Actions image publication and gated deployment
status: done
revision: 1
baseline_commit: 2ef09e1
depends_on:
  - Phase 3 production Docker image
allowed_paths:
  - .github/workflows/deploy.yml
  - README.md
  - WORK_LOG.md
  - docs/CI_CD_RUNBOOK.md
  - docs/TECH_SPEC.md
  - docs/sdd/**
forbidden_paths:
  - backend/src/**
  - frontend/src/**
---

# P04 — GitHub Actions image publication and gated deployment

## Goal

Every pull request proves that the production image builds. Every push to
`main` publishes the exact source revision to GHCR. Production deployment is an
explicitly enabled, serialized follow-up that deploys that immutable revision.

## Inputs and prerequisites

- Phase 3's root `Dockerfile` is the only production build definition.
- The target image is `ghcr.io/fallrising/obechow`.
- The VPS entrypoint is `/srv/deploy.sh twitter-deck <git-sha>`.
- Repository variables and secrets are external configuration, never committed.

## Delivery contract

| Surface | Contract |
|---|---|
| Pull request | Build the production image without registry login, push, or SSH |
| Push to `main` | Publish `latest` and the full `${{ github.sha }}` tag |
| Deploy gate | Run only when `vars.DEPLOY_ENABLED == 'true'` on a `main` push |
| Deploy target | Invoke `/srv/deploy.sh twitter-deck ${{ github.sha }}` |
| SSH trust | Require `SSH_HOST`, `SSH_USER`, `SSH_KEY`, and `SSH_FINGERPRINT` |
| Ordering | Never cancel or overlap production deploy jobs |
| Permissions | Default to `contents: read`; grant `packages: write` only to the build job |
| Action integrity | Pin non-GitHub actions to full commit SHAs |

`DEPLOY_ENABLED` defaults to disabled because an absent repository variable
does not equal the string `true`.

## BDD scenarios

### P04-BDD-01 — Pull request validation

**Given** a pull request changes the repository
**When** the workflow runs
**Then** it builds the root production image and does not log in to GHCR, push
an image, or start an SSH deployment.

### P04-BDD-02 — Immutable image publication

**Given** a commit is pushed to `main`
**When** the image build succeeds
**Then** GHCR receives both `latest` and a tag equal to the full Git commit SHA.

### P04-BDD-03 — Deployment disabled by default

**Given** `DEPLOY_ENABLED` is absent or not `true`
**When** a `main` build succeeds
**Then** the deploy job is skipped while image publication remains successful.

### P04-BDD-04 — Trusted, exact deployment

**Given** `DEPLOY_ENABLED` is `true` and all SSH secrets exist
**When** the published image build succeeds
**Then** the workflow verifies the configured host fingerprint and asks the VPS
to deploy the exact full Git SHA.

### P04-BDD-05 — Serialized production changes

**Given** two eligible `main` pushes arrive close together
**When** both reach deployment
**Then** production deploy jobs run in order without an in-progress deployment
being cancelled.

## Acceptance criteria

- The workflow passes `actionlint`.
- A clean Docker build completes from the repository root.
- All five BDD scenarios are mechanically inspectable in the workflow.
- No credential, private host, or deploy key is committed.
- The runbook documents the variable, four secrets, action pin update policy,
  and the disabled-by-default behaviour.
- `docs/TECH_SPEC.md` and the runbook mark Phase 4 complete only after evidence
  is recorded in `P04-verification.md`.

## Non-goals

- Provisioning the VPS, Traefik, DNS, or GitHub repository secrets.
- Changing application behaviour.
- Zero-downtime deployment.
- Tailscale setup.
- Claiming a live deployment without GitHub Actions and VPS evidence.
