---
document_type: verification-report
node_id: P06
status: passed
spec_revision: 2
implementation_commit: ecc90e6186341ef3d8d5454121dea60a777e598f
merge_commit: 58b21438567bedead154fc2d50e3c3bc3cdc696f
pull_request: 5
pr_validation_commit: ddd0aac07e0437074671abb2262379e53b73e1ff
pr_validation_run: 30534555874
main_validation_run: 30534658841
published_image_id: sha256:fba16ea878f2d344d4315cff11e010ca811cf18cb02e4006a0d3e7e394fc8e6d
published_image_digest: sha256:aff3e256c67aec56cb06482e62070e0344ab5f610e8f04d3add7fe86e49fb628
preflight_sha256: d559daafbda8019972ddb44c4dd296b2ebfb3a7fa118cfef48a7dd9dc4369a7b
preflight_test_sha256: fe6dddfde1409db71ca869543e63fef93ba7f54e03753cb654ff492df0f5120d
rehearsal_test_sha256: 3daf3defcc6a30aab9b28ed12105bd3296b5161a66c311fc2cb5ab4d7b712951
workflow_sha256: 15c18bbe34c6a2a12d78746d9f368849564e3a04f1852ae5a3e0419872264b8b
reviewer: codex
verified_at: 2026-07-30
---

# P06 verification report

## Current conclusion

All repository, local runtime, pull-request, merge, and `main` publication
gates pass. P06 repository readiness is complete. No VPS installation or live
deployment is claimed.

## Evidence ledger

| Requirement | Evidence | Result |
|---|---|---|
| Input isolation | 216-assertion focused contract | passed locally |
| Reviewed artifact identity | exact comparison and drift-stop assertions | passed locally |
| Docker/Compose/edge/Traefik checks | exact command and failure-prefix assertions | passed locally |
| DNS and immutable manifest checks | exact value and failure-prefix assertions | passed locally |
| Read-only command scope | exact allow-listed success log | passed locally |
| Local Docker replacement | isolated A-to-B Compose rehearsal | passed locally |
| Pull-request and merged-main workflow | PR run `30534555874`; main run `30534658841` | passed |

## Local commands

```text
bash -n ops/rollout-preflight.sh
bash -n tests/ops/rollout_preflight_test.sh
bash -n tests/ops/rollout_rehearsal_test.sh
tests/ops/deployment_bundle_test.sh
tests/ops/rollout_preflight_test.sh
tests/ops/rollout_rehearsal_test.sh
docker compose --env-file ops/.env.example -f ops/compose.yml config --quiet
/tmp/actionlint .github/workflows/deploy.yml
git diff --check
```

All commands exited zero. The contract suites reported 42 P05 assertions and
216 P06 assertions.

## Delegated review findings

| Severity | Finding | Resolution |
|---|---|---|
| high | failed `compose up --wait` could leave a partial rehearsal project because cleanup was armed only after success | arm exact-project cleanup before the first `up` |
| medium | preflight accepted a leading-hyphen Traefik name at a Docker option boundary | require an alphanumeric first character |
| medium | empty test path overrides silently selected production defaults | distinguish unset from empty and reject empty/relative paths |
| medium | delegated RED mutation oracle rejected the required read-only `compose up --help` | exact allow-list plus mutation-specific rejection |
| medium | initial Traefik/edge assertions used weak name output and omitted container typing | exact `--type container`, network name, NetworkID, and resolver argument checks |
| low | rehearsal initially omitted host-port, writable-bind, unique-network, and full tmpfs runtime values | inspect and assert the complete contract for both containers |

No delegated finding remains unresolved.

## Local Docker rehearsal evidence

`tests/ops/rollout_rehearsal_test.sh` built the root production image as
`ghcr.io/fallrising/obechow:59df06fd01796d085e400923329533d8573f5c94`
with local image ID
`sha256:a30e0777be62e979e9e0ee61c8da4a5a28246be4bef4ffd5f1568dc468b3f62b`.
It started an isolated Compose project on a unique bridge network without host
ports or an application-image pull.

Container `2dfc051f...` became healthy, accepted post id `1`, and was
force-recreated as `04f6b3d8...`. The replacement became healthy and returned
the same id, author, and content from the temporary SQLite bind. Both
containers reported:

- read-only root and `no-new-privileges`;
- empty host port bindings and only the unique rehearsal network;
- exact writable `/data` bind;
- `/tmp` as `rw,noexec,nosuid,nodev,size=64m`;
- `/sqlite-tmp` as `rw,exec,nosuid,nodev,size=16m`.

The bind contained `app.db`, `app.db-shm`, and `app.db-wal`. Exact cleanup and
independent post-run queries found no rehearsal container, network, image tag,
temporary directory, or repository `ops/data` directory.

## GitHub evidence

| Check | Result |
|---|---|
| PR #5 head | `ddd0aac07e0437074671abb2262379e53b73e1ff` |
| PR #5 run `30534555874` | `validate` passed, including both contract suites and the production image build; `publish` and `deploy` skipped |
| PR #5 squash merge | `58b21438567bedead154fc2d50e3c3bc3cdc696f` |
| Main run `30534658841` | `publish` passed, including both contract suites and image push; `validate` and `deploy` skipped |
| Immutable image | `ghcr.io/fallrising/obechow:58b21438567bedead154fc2d50e3c3bc3cdc696f` |
| Registry digest | `sha256:aff3e256c67aec56cb06482e62070e0344ab5f610e8f04d3add7fe86e49fb628` |

The main publication also updated `latest`, but deployment and rollback
contracts use only the immutable full-SHA tag. The skipped deploy job is
evidence that repository publication did not contact or modify a VPS.

## External activation gate

P06 repository readiness does not authorize a real rollout. Live evidence
requires operator-provided VPS, DNS, Traefik, GHCR, GitHub, smoke, and rollback
inputs listed in `P06-rollout-readiness.md`.
