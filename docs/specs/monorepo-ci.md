# Monorepo CI

## Context

The imported component workflows remain under component directories, which GitHub does not discover in this monorepo. Root workflows must provide continuous CI without inheriting their former release, image, or deployment behavior.

## Goal

Provide six root-level, path-scoped CI workflows for Goku, Phark, CloudForm, AweShore, Streaming Converter, and Ojbquay.

## Non-goals

Deploying, publishing images or releases, changing component source or dependencies, activating nested workflows, managing secrets, or running Ojbquay's full Compose end-to-end journey.

## Acceptance Criteria

Scenario: A pull request changes Goku web code
  Given a pull request touching `products/goku/web/**`
  When GitHub evaluates root workflows
  Then only the Goku workflow is eligible from this set
  And it runs all three Go module tests plus the web clean install, lint, and build

Scenario: A maintainer runs a workflow manually
  Given any of the six root workflows
  When it is dispatched manually
  Then its component-native CI checks run without deployment or publish credentials

Scenario: Ojbquay source changes
  Given a change under `systems/ojbquay/**`
  When its root workflow runs
  Then Java 25 Gradle build, pinned-pnpm console test/build, and deployment-model validation run
  And no full Compose end-to-end command runs

## Constraints

- Workflows are in `.github/workflows/`, use `contents: read`, explicit job timeouts, cancellation concurrency, and root-relative path filters including their own files.
- External actions are pinned to verified immutable SHAs; checkout disables persisted credentials. Node is pinned to 24.18.0 and both pnpm workflows activate pnpm 11.18.0 before frozen installs.
- The only Docker use is validation in CI where the native repository command requires it; no release/deploy/publish job or secret is introduced.
- Existing nested workflows remain dormant documentation of their source repositories.

## Design

Each component receives one independent workflow with `pull_request`, `push` to `main`, and `workflow_dispatch` triggers. Paths include the component subtree and that workflow file, so CI changes validate themselves. Jobs use checkout plus the relevant setup action and cache dependency files local to the component. Native gates are:

| Workflow | Gates |
| --- | --- |
| Goku | Three `go test ./...` modules; web `npm ci`, lint, build |
| Phark | Backend `mvn test`; frontend `npm ci`, lint, build |
| CloudForm | Backend `./gradlew test`; pinned-pnpm frontend lint/build |
| AweShore | UI `npm ci`, format check, lint, type check, build |
| Streaming Converter | `bash -n` for every checked-in shell script |
| Ojbquay | Java 25 `./gradlew build`; pinned-pnpm console test/build; `make validate-deploy` |

## Steps

1. Add this specification and make the root README identify root workflows as canonical.
2. Add six root workflows with path filters, read-only permissions, cancellation, timeouts, setup, caching, and native gates.
3. Validate workflow syntax and static policy with pinned actionlint plus local representative native gates.

## Verification

- Pinned actionlint container against `.github/workflows/*.yml`
- Static assertions for triggers, path filters, permissions, concurrency, timeouts, and forbidden release/deploy/publish or credential use
- Representative native gates: shell syntax; clean web install/lint/build where dependencies are available; component build/test commands where runtime prerequisites are available
- `git diff --check`
