---
document_type: implementation-plan
node_id: P04
status: done
derived_from:
  - P04-ci-cd.md
owner: codex
implementation_delegate: opencode
---

# P04 implementation plan

## Current state

- `main` is clean at `2ef09e1`.
- The production Docker image has already passed a local smoke test.
- `.github/workflows/deploy.yml` does not exist; this is the initial red state.
- No product source change is required.

## Design

One workflow owns build, publication, and deploy ordering:

```text
pull_request ──> build only
main push ─────> build + GHCR publish ──> optional serialized SSH deploy
```

Docker metadata generates the two required tags. Login and push are guarded by
the event type. The deploy job depends on the build job and has an explicit
repository-variable gate. SSH host-key verification uses a secret fingerprint;
the action and its downloaded SSH binary are version-pinned.

## Task DAG and ownership

```text
P04-T01 workflow implementation (OpenCode)
    └──> P04-T02 review, documentation, and verification (Codex)
```

| Task | Owner | Allowed paths |
|---|---|---|
| P04-T01 | OpenCode | `.github/workflows/deploy.yml` only |
| P04-T02 | Codex | P04 docs, README, work log, technical spec, runbook |

OpenCode must not commit, push, edit SDD requirements, or touch application
source. Codex reviews every changed line and may reject or rewrite the result.

## Security decisions

- Use `GITHUB_TOKEN`; do not introduce a long-lived GHCR write token.
- Keep workflow-level permissions read-only.
- Pin Docker and SSH actions by full commit SHA.
- Verify the VPS host key with `SSH_FINGERPRINT`.
- Do not interpolate user-controlled workflow inputs into the remote command.
- Deploy the immutable full SHA, never `latest`.

## Rollback

The workflow is one isolated implementation commit after the SDD baseline.
Rollback is a normal revert of that commit. Existing application images and
SQLite data are not modified by the repository change itself.

## Completion checklist

- [x] P04-T01 satisfies the frozen workflow contract after main-agent fixes.
- [x] Main-agent review has no unresolved finding.
- [x] `actionlint` passes.
- [x] Root Docker build passes.
- [x] Documentation matches the implemented secret and variable names.
- [x] Verification report records local evidence and clearly separates pending
      GitHub/VPS evidence.
