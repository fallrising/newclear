---
document_type: implementation-plan
node_id: P05
status: done
derived_from:
  - P05-vps-deployment-bundle.md
owner: codex
implementation_delegate: opencode
---

# P05 implementation plan

## Starting state

- `main` is clean at `ca66162`.
- P04 publishes immutable images and calls the intended VPS entrypoint.
- The runbook contains unversioned Compose and shell snippets that allow
  arbitrary app paths, default to `latest`, do not wait for health, and prune
  the host-wide image cache.
- No real VPS state is in scope for this repository phase.

## Design

The repository becomes the reviewed source for two installable production
files and their operator-facing environment template:

```text
ops/compose.yml ──> /srv/apps/twitter-deck/compose.yml
ops/.env.example ─> /srv/apps/twitter-deck/.env
ops/deploy.sh ────> /srv/deploy.sh
```

`deploy.sh` is intentionally application-specific at its trust boundary. It
validates the exact app name and immutable tag, resolves the fixed app
directory, validates Compose, pulls one service, and uses Compose's health
wait. `OBECHOW_DEPLOY_ROOT` exists only so the same code can be exercised in an
isolated test directory.

The Compose service has no published ports. Traefik discovers it through
labels on the external `edge` network. SQLite uses the app-local `data`
directory; the root filesystem is read-only. General `/tmp` is a bounded
`noexec` tmpfs, while SQLite JDBC extracts its native library to the separate
bounded `/sqlite-tmp` mount selected by `org.sqlite.tmpdir`.

## Task DAG and ownership

```text
P05-T01 production bundle (OpenCode)
    └──> Codex line review
          └──> P05-T02 contract tests + CI gate (OpenCode)
                └──> P05-T03 review, docs, smoke, evidence (Codex)
```

| Task | Owner | Allowed paths |
|---|---|---|
| P05-T01 | OpenCode | `ops/compose.yml`, `ops/.env.example`, `ops/deploy.sh` |
| P05-T02 | OpenCode | `tests/ops/**`, `.github/workflows/deploy.yml` |
| P05-T03 | Codex | P05 docs, README, work log, technical spec, runbook; corrections in all P05 paths |

OpenCode must not commit, push, edit SDD requirements, contact a VPS, enable
deployment, or touch application source. Codex reviews each delegated result
before the next task and may reject or rewrite it.

## Security decisions

- Require a full lowercase hexadecimal Git SHA and never accept `latest`.
- Permit only the literal application name expected by the workflow.
- Resolve the deployment directory from a fixed root, not user-supplied path
  fragments.
- Quote every shell expansion and use strict error handling.
- Do not use `eval`, dynamic shell construction, or global Docker cleanup.
- Require `APP_HOST`; do not silently route a placeholder hostname.
- Keep registry authentication external to the repository.

## Rollback

Operational rollback invokes the same script with a previously published full
SHA. Repository rollback is a normal revert of the P05 commits. Neither path
deletes the bind-mounted SQLite data directory.

## Completion checklist

- [x] P05-T01 passes main-agent line review after correcting image-boundary,
      Traefik matcher, and resolver-name findings.
- [x] P05-T02 proves valid sequencing and invalid-input isolation after
      strengthening the resolved-model and failure-stop oracles.
- [x] Compose model and workflow lint pass.
- [x] Production image passes health/read-only smoke verification after a
      dedicated executable SQLite tmpfs correction.
- [x] Documentation replaces unsafe inline examples with versioned artifacts.
- [x] Verification report separates repository completion from live VPS work.
