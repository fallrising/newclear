---
document_type: verification-report
node_id: P04
status: passed
spec_revision: 1
implementation_commit: 9152e5d6749feba17508159e669c3a8067676492
merge_commit: 2037ba806789f2cc3f1f9259194b740872b826f2
workflow_sha256: 1ae32591a722a4f47ba80a6075f47ad486201d95bcd5b11d647595c79f6e7491
published_image_digest: sha256:4949f200434630deed439f34ee6316888b1d2ec7b592d11e308968ae2ffe1174
reviewer: codex
verified_at: 2026-07-29
---

# P04 verification report

## Conclusion

The repository implementation passes every local gate, pull-request validation
passes online, and the merged `main` workflow publishes both required GHCR tags
while skipping deployment by default. P04 is complete. Live VPS deployment is
owned by Phase 5/6 and is not claimed here.

## Requirement evidence

| Requirement | Repository evidence | Result |
|---|---|---|
| PR build without credentials | PR run executes only `validate` | passed online |
| Main publishes `latest` and full SHA | main run pushes both tags to one digest | passed online |
| Deploy disabled by default | main run reports `deploy` skipped | passed online |
| Trusted exact deployment | fingerprint secret and full SHA remote command | contract passed; live gate deferred |
| Serialized deployment | `production-deploy`, `cancel-in-progress: false` | contract passed; live gate deferred |
| Immutable dependencies | seven action uses resolve to 40-character commit SHAs | passed locally |

## Commands

```text
/tmp/actionlint .github/workflows/deploy.yml
docker build -t obechow:p04-verification .
git diff --check
focused YAML contract assertions
```

All commands exited zero. The Docker build produced image
`sha256:a30e0777be62e979e9e0ee61c8da4a5a28246be4bef4ffd5f1568dc468b3f62b`
on the verification host.

## Review findings

| Severity | Finding | Resolution |
|---|---|---|
| medium | delegated PR build held `packages: write` | split `validate` and `publish` jobs |
| medium | downloaded SSH binary could float | pin `version: 1.8.2` |
| low | delegated draft used older action major versions | pin current official majors and checkout release by full SHA |

No unresolved local finding remains.

## Pull request evidence

[GitHub Actions run 30468132339](https://github.com/fallrising/obechow/actions/runs/30468132339)
completed successfully for PR #1 at final head `4f82956`:

| Job | Result |
|---|---|
| `validate` | success; checkout and production image build completed |
| `publish` | skipped |
| `deploy` | skipped |

This closes P04-BDD-01 with online evidence and confirms that the pull-request
path does not execute registry-login, image-push, or SSH steps.

## Main publication evidence

[GitHub Actions run 30469807025](https://github.com/fallrising/obechow/actions/runs/30469807025)
completed successfully for merge commit
`2037ba806789f2cc3f1f9259194b740872b826f2`:

| Job | Result |
|---|---|
| `validate` | skipped |
| `publish` | success; login, metadata, build, and push completed |
| `deploy` | skipped |

The publish log records both names on image digest
`sha256:4949f200434630deed439f34ee6316888b1d2ec7b592d11e308968ae2ffe1174`:

- `ghcr.io/fallrising/obechow:latest`
- `ghcr.io/fallrising/obechow:2037ba806789f2cc3f1f9259194b740872b826f2`

This closes P04-BDD-02 and P04-BDD-03 with online evidence.

## Residual external gate

After Phase 5 provisions the VPS and repository secrets, Phase 6 must enable
deployment and prove the exact published SHA runs on the trusted host. P04
deliberately does not create or mutate that external configuration.
