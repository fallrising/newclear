# M6 Console and Operations

## Context

M0-M5 provide the control plane and all producer, delay, push, pull, retry, and
DLQ data paths. The product still lacks the browser workflows and deployable
observability/operations bundle required for self-service use.

The accepted design requires React 19, TypeScript, Vite, Ant Design 5, TanStack
Query, Zustand, ECharts, and pnpm. It also requires real control-plane
operations behind sampling, preview, delay, progress, and offset-reset screens;
the web application must not present inert placeholders as completed features.

## Goal

An authenticated owner can onboard a topic, group, and subscription from one
browser, inspect delivery state, exercise the message workflows, and operate a
local full stack with documented dashboards and alerts.

## Non-goals

- OIDC provider integration; the existing local session flow remains v1.
- Share Group offset reset, which Kafka does not expose as the classic
  committed-offset workflow.
- Arbitrary payload editing or display without explicit user action.
- Production secret distribution, TLS certificate issuance, or a managed
  Kubernetes operator.
- A replacement for Prometheus or Grafana.

## Acceptance Criteria

- Given an unauthenticated browser, when it visits an application route, then
  it is redirected to login; successful session login loads role-aware
  navigation and logout invalidates the session.
- Given an owner, when they use the golden path to create a topic, group, and
  push or pull subscription, then the REST resources are persisted and the
  resulting desired versions are visible in the console.
- Given a subscription draft and sample message, when preview runs, then tag,
  shadow, CEL, and transit behavior returns a pass/drop result and transformed
  body without producing a broker record.
- Given a topic, when an owner samples or sends a test message, then the
  operation uses the real Kafka topic, enforces bounded inputs, and never writes
  payload content to logs.
- Given a classic ordered subscription, when offset reset is requested, then
  the subscription is paused and published, the broker group must become empty,
  offsets are previewed and altered, the subscription is resumed and published,
  and all phases are audited. Failure before broker silence does not alter
  offsets. Pull and unordered Share subscriptions return `UNSUPPORTED`.
- Given a delay ID, when it is queried or a pending record is canceled, then the
  console reports its durable PostgreSQL state and cancellation uses the same
  delay inbox command as the SDK path.
- Given dead letters, when an owner browses and replays selected records, then
  the existing bounded, audited DLQ API is usable from the browser.
- Given OPS or ADMIN, when they inspect clusters, users, or audit, then those
  routes are available and USER access is denied.
- Given mock API handlers, when web unit tests run, then authentication,
  dashboard, create-subscription preview, and error behavior pass.
- Given the Playwright mock golden path, when topic, group, and subscription are
  created, then the dashboard shows the resulting active resources and delivery
  success signal.
- Given deployment validation, when Compose, Kubernetes, Prometheus, Grafana,
  and alert-rule checks run, then their models parse and all configured
  dashboards/probes/scrape targets are present.
- Given the local stack, when `make e2e` runs, then health probes, login, topic
  creation, production, and observable delivery complete without manual broker
  configuration.

## Constraints

- Keep Spring Boot in `console-api` only; data planes remain framework-free.
- Browser mutations retain CSRF protection and same-origin session cookies.
- UI server state uses TanStack Query and local presentation state uses
  Zustand; no duplicate global state store is introduced.
- Pages remain usable at 1280 px and 390 px widths and expose accessible labels
  for the golden path.
- Samples are bounded to 1..100 records, payloads are Base64 in REST responses,
  and test messages use the existing 4 MiB limit.
- Offset reset waits at most 60 seconds for a classic group to become empty and
  always attempts to restore the previous subscription state.
- Dashboards and alert expressions reference metric names actually emitted by
  the repository.
- Compose defaults stay local-development only. Kubernetes Secrets contain
  placeholders, never credentials.

## Assumptions and Unknowns

- Local Compose is single-node and intentionally plaintext. Production
  authentication, certificates, and secret injection are environment concerns
  documented in the runbook.
- The browser golden path uses deterministic MSW/Playwright API fixtures; the
  repository-level `make e2e` provides real service wiring evidence.
- Kafka Share Group lag/detail APIs are still evolving. V1 progress returns
  `UNSUPPORTED` for Share subscriptions instead of inventing classic offsets.
- Per-instance loaded configuration is observable through
  `ojbk_sub_config_version`; the console shows desired publication state while
  Grafana compares runtime version metrics. A durable runtime-heartbeat registry
  is deferred.

## Design

`console-api` gains small services at owned boundaries:

- `TopicMessageOperations` samples and publishes test records.
- `SubscriptionPreviewService` reuses the common CEL/transit semantics.
- `GroupOperations` reports classic offsets and performs previewed reset only
  after an empty-group hard gate.
- `DelayService` queries PostgreSQL and publishes cancellation commands.
- cluster/user endpoints expose bounded administrative views.
- a Prometheus lag exporter renders the same classic progress model.

`console-web` is a Vite single-page application with a typed `apiClient`,
session/CSRF bootstrap, query-backed pages, resource forms, a subscription
wizard, DLQ/delay/operations screens, and an ECharts dashboard. Tests use MSW;
Playwright runs a deterministic golden path through the production build.

Deployment assets add explicit Java/web container images, full-stack Compose,
Kubernetes manifests, Prometheus targets/rules, Grafana provisioning plus three
dashboards, and make targets for lifecycle and acceptance.

## Steps

1. Add failing console-operation contract and integration tests.
2. Implement sampling, preview, progress/reset, delay, cluster/user, and lag
   exporter APIs with authorization and audit.
3. Scaffold the pinned pnpm/React application and implement the authenticated
   golden-path pages.
4. Add MSW unit tests and Playwright browser acceptance.
5. Add container, Compose, Kubernetes, Prometheus, Grafana, alert, Make, and
   runbook assets.
6. Run web, Java, deployment-model, real Compose, and full repository gates.

## Verification

- `./gradlew :modules:console-api:test` — passed 28 tests against Kafka 4.2
  and PostgreSQL 17 Testcontainers.
- `pnpm -C console-web test` — passed 5 tests across 4 files.
- `pnpm -C console-web build` — passed TypeScript and production Vite build.
- `pnpm -C console-web e2e` — passed the Chromium golden path.
- `make validate-deploy` — passed Compose rendering, Prometheus configuration
  and 5 rules, 3 Grafana dashboard models, and Kubernetes Kustomize rendering.
- `make e2e` — passed health, session/CSRF login, real provisioning, gRPC
  production, Share Group HTTP push, gateway metric, and Prometheus target
  checks, then removed the isolated stack and volumes.
- The final repository-wide `./gradlew build` is recorded separately in
  `docs/execution-plan.md`.

Known build warnings are the existing Protobuf/JDK 25 `Unsafe` notice and a
Vite recommendation to split the 2.4 MiB minified application bundle. Neither
invalidates the verified M6 behavior; route-level code splitting remains a
performance follow-up.
