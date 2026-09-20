# M0 implementation contract — revision 2

Source specification: `1117d297aa3efef9472d847c9dfa5714eb6c4460`. This document fixes shared implementation interfaces; the SDD remains authoritative. AC-01–03 are the M0 gate. M1–M5 business journeys remain unavailable. A minimal seed is intentional, and all counts must describe that seed rather than the future 60 CI dataset.

Revision 2 records integration clarifications: API prefixes are application-base-relative; saved envelope includes stable tab ownership; wire DTO/OpenAPI are generated from shared Zod. Worker contracts remain bound to revision 1 at their recorded base. See ADR-012–014 in [decisions](sdd/08-decisions-sources.md).

## Ownership and boundaries

- Orchestrator: package/lock/config, CI, documentation, task ledger, integration and E2E acceptance.
- T-001: `src/domain/**`, `src/demo/seed.ts`; pure domain schemas, policy, atomic command engine and focused tests.
- T-002: `src/api/**`, `src/demo/{controller,handlers,browser}.ts` and adjacent tests; persistence, identity, HTTP transport and session lifecycle.
- T-003: `src/app/**`, `src/components/**`, `index.html`; UI consumes only the API client, never fixtures/engine. `src/app/main.tsx` may import `startDemo` from demo/browser for bootstrap only.
- Shared contract changes are proposed to the orchestrator before editing this document. Workers do not commit, push, change PLAN or delegate.

## Domain boundary (T-001 provides)

`src/domain/schemas.ts` exports Zod schemas and inferred `Snapshot`, `Persona`, `SessionView`, `DashboardView`, `GuideView`, `CommandReceipt`, `ApiResult<T>`, `ApiError`, `Center = 'rd' | 'ops' | 'admin'` and `CommandInput` types. All data returned by handlers must be JSON serializable.

`Persona`: `{id, displayName, description, centers: Center[]}`.

`SessionView`: `{user: {id, displayName}, assignments, effectiveActions: string[], centers: Center[], demo: true, sessionId, identityEpoch, generation, policyVersion, storeRevision, logicalClock, storageMode: 'session' | 'memory'}`. Assignment entries retain the SDD scope fields. Clock is a nonnegative logical tick counter; the seed's fixed ISO baseline is separate.

`DashboardView`: `{center, title, applicationCount, environmentCount, ciCount, providers: {provider: 'aws'|'aliyun'|'onprem', count: number}[], dataAsOf: string}`. Counts filter by caller scope before aggregation; no production telemetry is inferred.

`GuideView`: `{logicalClock, storeRevision, sessionId, seedVersion, schemaVersion, pendingTasks: number, commandCount: number}`. UI describes this as session controls and foundation progress, never a completed business journey.

`Snapshot`: at least `{schemaVersion: 1, seedVersion: 'dim-gate-v1', sessionId, logicalClock, sequence, storeRevision, policyVersion, commandCount, entities, jobs, events, audit, idempotency, scenarioFlags}` plus deterministic scheduler state and reset metadata if needed. Domain may add fields without changing these names. Engine owns mutations, events/audit/idempotency in one persisted snapshot. No React, DOM, MSW, random numbers or wall clock in domain.

`src/demo/seed.ts` exports `createSeed(sessionId: string): Snapshot`, `personas: Persona[]`. Minimum 2 RD personas, 1 Ops, 1 Admin, scoped projects/apps/environments and one valid CI for each provider. Stable IDs match SDD examples. Admin has no deployment role.

`src/domain/engine.ts` exports `createEngine(initial: Snapshot, persist: (next: Snapshot) => void): Engine`. `Engine` has:

```ts
getSnapshot(): Snapshot // defensive copy; callers cannot mutate authoritative state
read(path: string, query: URLSearchParams, actorId: string): unknown
command(input: CommandInput): Promise<CommandReceipt>
```

Paths omit `/api/v1` or `/__demo/v1`. `CommandInput` = `{sessionId: string, actorId: string, method: string, path: string, key: string, body: unknown}`. Pure `DomainError` extends Error with `{status: number, code: string, fieldErrors?: Record<string,string[]>}`.

M0 reads: `/session`, `/dashboard?center=...`, `/organization`, `/navigation?center=...`, `/cis`, `/cis/:id`, `/applications`, `/guide`. M0 engine commands: `PATCH /cis/:id` (SDD metadata contract), `DELETE /admin/assignments/:id` (policy revocation and self/last-admin protection), `POST /clock/advance` (`ticks` 1..60). This is the minimum useful command substrate for AC-03, not M1/M2 acceptance. Undelivered endpoints must return explicit failure, never fake successful receipts. Handler authenticates and rejects unknown query/body fields. Same key/body replay after authorization returns same receipt; altered body conflicts; failed persistence leaves every counter and entity unchanged.

Identity/snapshot context enrichment belongs to controller; engine `/session` may return only domain fields, which controller combines into `SessionView`. `/guide` likewise adds controller session metadata as needed. Export schemas for entity/command/response validation and OpenAPI generation; do not add a second separately maintained entity type system.

## HTTP/controller boundary (T-002 provides)

`src/demo/controller.ts` exports a dependency-injectable controller factory for tests and `getController()` for browser use. Controller injects sessionStorage, random session ID generation and timer APIs outside domain. Snapshot key `dim-gate.demo.v1`. Persona selection/identity metadata persists across reload. On reset: stop timers, replace engine with seeded snapshot, increase generation/epoch, cancel old work; failed reset persistence retains old state. Retain reset replay tombstone. Forked tabs must have independent session identity (detect via browser tab coordination or document a tested strategy). Corrupt/incompatible snapshots display recoverable error, not silent reset. Memory fallback is explicit user choice.

`src/demo/handlers.ts` exports `createHandlers(controller)`; browser and Node tests use identical handlers. `/api/v1` requests authenticate `X-Demo-Persona`/`X-Demo-Session`. Demo controls use `/__demo/v1/personas`, `/persona`, `/guide`, `/reset`, `/clock/advance`, with required idempotency keys. Normal delay 150 ms. Reset/persona commands return envelope data containing updated `session: SessionView` and command receipt as appropriate.

The prefixes are relative to Vite `BASE_URL`: default browser requests use `/dim-gate/api/v1` and `/dim-gate/__demo/v1`. Persona/reset controls return `{session: SessionView}` inside the envelope. The strict saved wrapper contains `formatVersion:1`, the domain snapshot, persona/epoch/generation, persona replay records, one reset tombstone and `tabOwnershipId`. A document holds a Web Lock for the ownership ID across reset; a copied tab forks both IDs. The entire UTF-8 envelope is bounded by 3 MiB; domain plus persona commands share the 1000-command budget. Runtime imports only small shared control DTOs; the forward operation registry is build/test tooling.

`src/demo/browser.ts` exports `startDemo(mode: string | undefined): Promise<void>`: error for missing mode, explain unsupported live, start MSW only for explicit demo; service worker URL and scope use Vite `BASE_URL`. Fail unhandled app API requests loudly; never intercept another app's API outside worker scope.

`src/api/client.ts` exports `api` with these Promise-returning methods:

```ts
getSession(): Promise<SessionView>
getPersonas(): Promise<Persona[]>
getDashboard(center: Center): Promise<DashboardView>
getGuide(): Promise<GuideView>
setPersona(personaId: string): Promise<SessionView>
reset(): Promise<SessionView>
advanceClock(ticks: number): Promise<CommandReceipt>
subscribe(listener: () => void): () => void
```

API client may import public types from domain schemas, but no fixture or demo engine. Bootstrap passes controller identity into client via `configureClient` or equivalent; UI never constructs private headers. Client rejects stale responses across persona, scope/policy changes and reset. API change notifications trigger Query cancellation/cache clearing on identity changes and invalidation on ordinary commands. Errors carry code/message/requestId/retryability. Query keys include current sessionId/identityEpoch/policyVersion, resource family, scope and filters.

## UI and M0 design brief (T-003 provides)

Audience: RD/Ops/Admin exploring a shared operations console. Use the specified neutral/indigo console, a compact 240px sidebar, 56px header, deliberate typography and readable CJK. Center overview shows scope-filtered inventory summaries, role purpose and session facts; the guide offers working clock advance and confirmed reset. The application constantly labels synthetic data. No unusable navigation, invented cloud health, decorative fake time series or empty module pages.

Routes `/rd`, `/ops`, `/admin`, `/guide`, root persona redirect; forbidden centers have a readable access explanation and persona selection. Persona role grants control navigation and route guards. Scope changes/persona switch clear incompatible context. Prefer semantic native controls with accessible labels, shadcn-style Button and Radix Dialog primitives, visible focus, skip link, dark/light and density preferences. Reset dialog traps/returns focus and supports Esc. Layout at 1440, 768 and 390; local table scroll only. Loading, error with request ID/retry, forbidden, corrupted storage recovery and pending states must be usable.

UI bootstrap handles missing/live mode and storage errors visibly; controller's explicit memory fallback may be exposed by a recovery action. Do not silently recover by wiping saved data.

## Native gates

Component directory: `platform/dim-gate`. Node 24.18.0, pnpm 11.18.0, exact package versions and lockfile. `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:docs`, `pnpm check:contracts`, `pnpm build --mode demo`, `pnpm test:e2e`. E2E runs a production build at `/dim-gate/`. Browser assertions must cover AC-01/02; domain plus shared HTTP contract assertions cover AC-03 and persistence failure atomicity. Final independent review targets a fixed implementation commit; metadata checkpoints can reference it only while code/config/lockfiles stay identical.
