---
document_type: test-plan
node_id: P04
status: done
derived_from:
  - P04-ci-cd.md
  - P04-implementation-plan.md
owner: codex
---

# P04 test plan

## BDD mapping

| BDD | Level | Oracle |
|---|---|---|
| P04-BDD-01 | workflow/static | PR event exists; login, push, and deploy guards exclude PRs |
| P04-BDD-02 | workflow/static + GitHub | main push has raw `latest` and full-SHA tags; GHCR shows both |
| P04-BDD-03 | workflow/static + GitHub | deploy job has the exact repository-variable gate and is skipped by default |
| P04-BDD-04 | workflow/static + VPS | SSH step requires fingerprint and passes the full SHA to `deploy.sh` |
| P04-BDD-05 | workflow/static + GitHub | deploy concurrency has `cancel-in-progress: false` |

## Red state

| Test | Initial failure |
|---|---|
| Workflow lint | `.github/workflows/deploy.yml` is absent |
| Contract inspection | No event, tag, permission, or deploy gate exists |
| GitHub run | No Phase 4 workflow can run |

## Local verification

1. Run `actionlint .github/workflows/deploy.yml`.
2. Parse the YAML and inspect event/job/step expressions.
3. Run `docker build -t obechow:p04-verification .`.
4. Run `git diff --check`.
5. Confirm no probable secret material is present in the diff.

## Online verification

1. Open a pull request and confirm build-only behaviour.
2. Merge or push to `main`; confirm full-SHA and `latest` packages in GHCR.
3. With deployment disabled, confirm deploy is skipped.
4. After Phase 5 and secrets are configured, enable deployment and confirm the
   VPS runs the same SHA reported by the workflow.

## Exit criteria

Local checks must pass before commit. P04 may be marked repository-complete
with online items explicitly pending, but it must not claim end-to-end Phase 6
completion until GHCR and VPS evidence exists.
