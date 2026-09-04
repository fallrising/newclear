---
document_type: test-plan
node_id: P06
status: done
derived_from:
  - P06-rollout-readiness.md
  - P06-implementation-plan.md
owner: codex
---

# P06 test plan

## BDD mapping

| BDD | Level | Oracle |
|---|---|---|
| P06-BDD-01 | shell contract | exact read-only command log and exact success values; explicit no-deploy text |
| P06-BDD-02 | shell contract | each invalid case exits non-zero with no external-command log |
| P06-BDD-03 | filesystem contract | changed installed file stops at the exact `cmp` and leaves host-command log empty |
| P06-BDD-04 | shell contract | injected failure produces the exact command prefix, no later command, and no success |
| P06-BDD-05 | Docker integration | healthy A-to-B replacement retains a uniquely identified post and hardening values |

## RED state

`tests/ops/rollout_preflight_test.sh` must initially fail for the expected
reason that `ops/rollout-preflight.sh` does not exist. A test that passes
without the production file is invalid.

## Hermetic preflight contract

Use a temporary reviewed tree, installed tree, fake Docker binary, and fake DNS
resolver. The success oracle must assert the full ordered command log:

1. reviewed-to-installed Compose comparison;
2. reviewed-to-installed deploy comparison;
3. Docker Engine response;
4. Compose version and `up --help`;
5. exact `edge` lookup;
6. Traefik running and edge attachment;
7. Traefik command inspection for resolver `le`;
8. exact Compose validation, services, and image resolution;
9. DNS A lookup;
10. release manifest inspection;
11. rollback manifest inspection.

The fake adapters return exact values, not merely successful exit codes.

## Invalid-input matrix

Each case must fail before any fake Docker, DNS, or comparison adapter runs:

- zero, one, two, or four arguments;
- unknown or shell-like app name;
- empty, short, uppercase, non-hex, mutable, or shell-like SHA;
- equal release and rollback SHA;
- missing, uppercase, scheme-prefixed, slash-containing, empty-label,
  overlong-label, or shell-like hostname;
- missing or invalid/out-of-range IPv4;
- missing, leading-hyphen, or shell-like Traefik container name;
- empty or relative source, deploy-root, or deploy-script override.

At least one shell-like value must include a harmless marker path and the test
must prove the marker was not created.

## Drift and failure matrix

- Missing app directory, Compose file, or executable deploy entrypoint.
- Installed Compose mismatch.
- Installed deploy mismatch.
- Docker Engine failure.
- Compose version failure.
- Missing `--wait`.
- Wrong edge network name.
- Stopped Traefik.
- Missing edge attachment.
- Resolver `le` absent.
- Compose validation failure.
- Resolved service not exactly `app`.
- Resolved image not the exact release SHA.
- DNS failure or address mismatch.
- Release manifest failure.
- Rollback manifest failure.

Every case asserts non-zero status, exact stopping prefix, and absent success.

## Mutation oracle

The complete success log must be allow-listed. It must contain none of:

- `deploy.sh`;
- `compose pull`, `up`, `down`, `rm`, `kill`, or `restart`;
- `docker login`, `logout`, `run`, `exec`, `network create/rm`, or prune;
- mutable image tags.

This is secondary to the exact positive command-sequence assertion.

## Real Docker rehearsal

1. Build the production image under a synthetic full-SHA local tag.
2. Create a unique temporary bind directory, Compose project, and bridge
   network.
3. Resolve the P05 Compose model with a test hostname and exact tag.
4. Start only `app` with `pull_policy: never` and wait for health.
5. Inspect exact read-only root, `no-new-privileges`, `/data`, `/tmp`, and
   `/sqlite-tmp` settings.
6. POST a uniquely identifiable record and assert its returned values.
7. Force-recreate only `app`, wait for health, and GET the exact persisted
   record.
8. Remove only resources created by the rehearsal.

The rehearsal does not run Traefik, access GHCR, contact a VPS, resolve public
DNS, or validate GitHub settings.

## Quality gate

```text
bash -n ops/rollout-preflight.sh
bash -n tests/ops/rollout_preflight_test.sh
bash -n tests/ops/rollout_rehearsal_test.sh
tests/ops/deployment_bundle_test.sh
tests/ops/rollout_preflight_test.sh
tests/ops/rollout_rehearsal_test.sh
docker compose --env-file ops/.env.example -f ops/compose.yml config --quiet
actionlint .github/workflows/deploy.yml
git diff --check
```

If a broader check cannot run, record the exact reason and retain the narrower
evidence. Local rehearsal success cannot satisfy the external live gate.
