---
document_type: implementation-plan
node_id: P06
status: done
derived_from:
  - P06-rollout-readiness.md
owner: codex
implementation_delegate: grok
---

# P06 implementation plan

## Starting state

- Local and remote `main` are clean at
  `4721ed72f1398f1698980725ec1e98786eaa2f9d`.
- PR #3 and PR #4 are merged.
- Workflow run `30516206314` published the image successfully and skipped
  deployment.
- P05 has 42 repository contract assertions and local read-only persistence
  evidence.
- No VPS, domain, DNS, SSH, Traefik, GHCR credential, GitHub secret, or
  maintenance-window value is available in this workspace.
- Docker 27.5.1 and an authenticated Grok CLI 0.2.114 are available locally.

## Design

The read-only preflight runs on the target host from a reviewed checkout:

```text
validate all input
  -> compare installed files with reviewed files
  -> inspect Docker/Compose capability
  -> inspect edge/Traefik state
  -> resolve exact Compose service/image
  -> compare DNS result
  -> inspect release and rollback manifests
  -> report "no deployment performed"
```

The command surface is deliberately fixed. Test-only absolute path overrides
allow fake host state without adding arbitrary applications or commands.
Docker and DNS adapters are exercised through PATH-injected fakes in contract
tests. A separate local rehearsal uses real Docker only inside a uniquely
named Compose project and network.

## Task DAG and ownership

```text
P06-T01 RED preflight contract tests (Grok)
  -> Codex review/correction
  -> P06-T02 preflight implementation (Grok)
     -> Codex security/correctness review
     -> P06-T03 CI gate and Docker rehearsal (Grok + Codex runtime review)
        -> P06-T04 documentation, evidence, and delivery (Codex)
```

| Task | Owner | Allowed paths |
|---|---|---|
| P06-T01 | Grok | `tests/ops/rollout_preflight_test.sh` |
| P06-T02 | Grok | `ops/rollout-preflight.sh` |
| P06-T03 | Grok | `tests/ops/rollout_rehearsal_test.sh`, `.github/workflows/deploy.yml` |
| P06-T04 | Codex | P06 allowed paths for review corrections and documentation |

Grok may not edit SDD requirements, commit, push, contact a VPS, use real
credentials, enable deployment, or touch application/P05 production files.
Codex reviews every line and may reject or rewrite the result.

## Security design review

- Validate every scalar and absolute test path before the first external
  command.
- Use arrays or direct quoted arguments; never reconstruct a shell command.
- Compare reviewed artifacts before host or network checks.
- Make every Docker command read-only and enumerate it in contract tests.
- Treat DNS, Traefik output, Compose output, and manifest responses as
  untrusted data.
- Match exact expected service, image, network, resolver, address, and success
  output rather than testing keyword presence alone.
- Do not source `.env` or print environment contents.
- Keep external activation manual until all live inputs and authorization
  exist.

## Implementation steps

1. Add the RED contract test and prove it fails because the preflight is
   absent.
2. Add the minimum preflight implementation and pass the focused test.
3. Add the test to both workflow build paths without altering P04 gates.
4. Add and run the isolated real-Docker replacement rehearsal.
5. Run the full affected quality gate and review the complete diff.
6. Update the runbook, roadmap, work log, and verification evidence.
7. Commit atomically, push, open a PR, inspect Actions, merge only when green,
   and synchronize local `main`.

## Rollback

- Before merge: delete only the new branch or correct its additive files; do
  not touch `main`.
- After merge: revert the P06 repository commit through normal Git review.
- Rehearsal cleanup targets only its generated Compose project, named
  containers, temporary bind directory, and network.
- No live rollback is exercised by this plan. The future live operator uses
  the verified rollback SHA through `/srv/deploy.sh twitter-deck <sha>`.

## Completion checklist

- [x] RED failure observed for the missing preflight.
- [x] Delegated tests accepted after main-agent corrections.
- [x] Delegated implementation accepted after main-agent security corrections.
- [x] P05 and P06 contract suites pass locally.
- [x] Local real-Docker replacement rehearsal passes and cleans up.
- [x] Workflow and documentation match the SDD locally.
- [x] PR and merged-main checks pass.
- [x] No live VPS or enabled deployment is claimed.
