# Monorepo CI

## Context

The imported component workflows remain under component directories, which GitHub does not discover in this monorepo. Root workflows must provide continuous CI without inheriting their former release, image, or deployment behavior. The tree already includes `prism-ci.yml` for `platform/prism` in addition to the original Goku, Phark, CloudForm, AweShore, Streaming Converter, and Ojbquay workflows; Kith is added as `.github/workflows/kith.yml`.

## Goal

Provide root-level, path-scoped CI workflows for selected executable components, including imported private-to-public snapshots whose nested workflows are no longer active. Named members of this set include Goku, Phark, CloudForm, AweShore, Streaming Converter, Ojbquay, Prism, Ice Maker, Local OCR Services, CMS Scaffold, Dim Gate, and Kith.

## Non-goals

Deploying, publishing images or releases, changing component source or dependencies, activating nested workflows, managing secrets, or running Ojbquay's full Compose end-to-end journey.

## Acceptance Criteria

Scenario: A pull request changes Goku web code
  Given a pull request touching `products/goku/web/**`
  When GitHub evaluates root workflows
  Then only the Goku workflow is eligible from this set
  And it runs all three Go module tests plus the web clean install, lint, and build

Scenario: A maintainer runs a workflow manually
  Given any selected root workflow
  When it is dispatched manually
  Then its component-native CI checks run without deployment or publish credentials

Scenario: Ojbquay source changes
  Given a change under `systems/ojbquay/**`
  When its root workflow runs
  Then Java 25 Gradle build, pinned-pnpm console test/build, and deployment-model validation run
  And no full Compose end-to-end command runs

Scenario: Prism source changes
  Given a change under `platform/prism/**`
  When GitHub evaluates root workflows
  Then `.github/workflows/prism-ci.yml` is eligible
  And it runs golangci-lint, dependency-direction checks, and `make lint test` with `contents: read` and no secrets or deploy

Scenario: Kith source changes
  Given a change under `products/kith/**` or `.github/workflows/kith.yml`
  When GitHub evaluates root workflows
  Then `.github/workflows/kith.yml` is eligible
  And it runs Node 24.18.0 `npm ci`, `npm run lint`, and `npm test` in `products/kith`, `npm ci` and `npm run build` in `products/kith/web`, and the Playwright E2E suite (`npm run e2e:all`, `npm run e2e:validate`) with evidence uploaded as an artifact, with `contents: read` and no secrets or deploy

## Constraints

- Workflows are in `.github/workflows/`, use `contents: read`, explicit job timeouts, cancellation concurrency, and root-relative path filters including their own files.
- External actions are pinned to verified immutable SHAs; checkout disables persisted credentials. Node is pinned to 24.18.0 and both pnpm workflows activate pnpm 11.18.0 before frozen installs.
- The only Docker use is validation in CI where the native repository command requires it; no release/deploy/publish job or secret is introduced.
- Existing nested workflows remain dormant documentation of their source repositories.

## Design

Each component receives one independent workflow with `pull_request`, `push` to `main`, and `workflow_dispatch` triggers. Paths include the component subtree and that workflow file, so CI changes validate themselves. Jobs use checkout plus the relevant setup action and cache dependency files local to the component. Native gates are:

| Workflow | File | Paths | Gates |
| --- | --- | --- | --- |
| Goku | `goku-ci.yml` | `products/goku/**`, `.github/workflows/goku-ci.yml` | Three `go test ./...` modules; web `npm ci`, lint, build |
| Phark | `phark-ci.yml` | `products/phark/**`, `.github/workflows/phark-ci.yml` | Backend `mvn test`; frontend `npm ci`, lint, build |
| CloudForm | `cloudform-ci.yml` | `apps/cloudform/**`, `.github/workflows/cloudform-ci.yml` | Backend `./gradlew test`; pinned-pnpm frontend lint/build |
| AweShore | `aweshore-ci.yml` | `labs/aweshore/**`, `.github/workflows/aweshore-ci.yml` | UI `npm ci`, format check, lint, type check, build |
| Streaming Converter | `streaming-converter-ci.yml` | `tools/streaming-converter/**`, `.github/workflows/streaming-converter-ci.yml` | `bash -n` for every checked-in shell script |
| Ojbquay | `ojbquay-ci.yml` | `systems/ojbquay/**`, `.github/workflows/ojbquay-ci.yml` | Java 25 `./gradlew build`; pinned-pnpm console test/build; `make validate-deploy` |
| Prism | `prism-ci.yml` | `platform/prism/**`, `.github/workflows/prism-ci.yml` | golangci-lint; dependency-direction check; `make lint test` |
| Ice Maker | `ice-maker-ci.yml` | `platform/ice-maker/**`, `.github/workflows/ice-maker-ci.yml` | Python 3.11 repository-native `make check` with full Git history available |
| Local OCR Services | `local-ocr-services-ci.yml` | `platform/local-ocr-services/**`, `.github/workflows/local-ocr-services-ci.yml` | Repository-native `make check` (syntax, contract-test image, Compose rendering) |
| CMS Scaffold | `cms-scaffold-ci.yml` | `apps/cms-scaffold/**`, `.github/workflows/cms-scaffold-ci.yml` | Java 25 `./gradlew test`; Node 24 `npm ci`, test, lint, typecheck, and build |
| Dim Gate | `dim-gate-ci.yml` | `platform/dim-gate/**`, `.github/workflows/dim-gate-ci.yml` | Component-native lint/test with `contents: read` |
| Kith | `kith.yml` | `products/kith/**`, `.github/workflows/kith.yml` | Node 24.18.0 `npm ci`, `npm run lint`, `npm test` in `products/kith`; `npm ci`, `npm run build` in `products/kith/web`; `npm run e2e:all` + `npm run e2e:validate` (Playwright 1.56.1 Chromium), evidence artifact kept 14 days; `contents: read`; no secrets or deploy |

All listed workflows use `permissions.contents: read`. None introduce deploy, publish, or secret-backed jobs.

## Steps

1. Add this specification and make the root README identify root workflows as canonical.
2. Add selected root workflows with path filters, read-only permissions, cancellation, timeouts, setup, caching, and native gates.
3. Validate workflow syntax and static policy with pinned actionlint plus local representative native gates.

## Verification

- Pinned actionlint container against `.github/workflows/*.yml`
- Static assertions for triggers, path filters, permissions, concurrency, timeouts, and forbidden release/deploy/publish or credential use
- Representative native gates: shell syntax; clean web install/lint/build where dependencies are available; component build/test commands where runtime prerequisites are available
- `git diff --check`
