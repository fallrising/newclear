---
document_type: task
id: P04-T01
node_id: P04
title: Implement the build, publish, and deploy workflow
status: done
owner: opencode
allowed_paths:
  - .github/workflows/deploy.yml
forbidden_paths:
  - docs/**
  - backend/**
  - frontend/**
  - Dockerfile
---

# P04-T01 — Implement the workflow

## Single outcome

Create `.github/workflows/deploy.yml` that satisfies every contract row and BDD
scenario in `../P04-ci-cd.md`.

## Required design

- Trigger for pull requests and pushes to `main`.
- Build the root `Dockerfile` on both event types.
- Login and push only for a non-PR `main` push.
- Publish `ghcr.io/fallrising/obechow:latest` and
  `ghcr.io/fallrising/obechow:${{ github.sha }}`.
- Gate deploy on `vars.DEPLOY_ENABLED == 'true'`.
- Use SSH host fingerprint verification.
- Serialize deploy jobs without cancelling an active deployment.
- Pin Docker and Appleboy actions to full commit SHAs, with version comments.

## First failing test

`actionlint .github/workflows/deploy.yml` fails because the file does not exist.

## Handoff

Do not commit or push. Report the file changed, assumptions, and checks run.
