# M1 integration contract — CMDB and application views

Revision 2. Revision 1 was fixed after the T-006 M0 regression at `49e1b89754421cf0e2f76026416a1af184ceab94`; revision 2 closes T-012 findings F-01 and F-02 without changing wire DTO ownership. This document owns integration semantics; Zod schemas and the generated [OpenAPI](openapi.json) remain the only wire-format field definition.

## Boundaries and public exports

- `src/features/cmdb/index.ts` is the only app-level import surface for CMDB UI. It re-exports public application, CI and topology route components from their own internal `index.ts`; private state, hooks and view helpers stay inside the owning subtree.
- `src/api/client.ts` is the compatibility composition facade. Shared transport, envelope validation, identity epoch/generation checks, stale-response rejection and idempotency live under `src/api/core/`. Feature clients live under `src/api/clients/`; cache families live in `src/api/query-definitions.ts`.
- `src/api/contracts.ts` is the only operation registry. Core/session, CMDB/application/environment, topology/relation/search and future declarations live under `src/api/contracts/`. They register into one OpenAPI document.
- `src/demo/handlers.ts` and `src/demo/seed.ts` are composition roots. Feature handlers and seed builders may not own persistence or bypass the shared domain engine.
- `src/domain/` remains the single home of entity IDs, schemas, policy, integrity, atomic command queue, persistence transaction, events and audit.

## Routes

Only registry entries with real components may be navigated. Navigation configuration can relabel, order or hide an existing entry; it cannot create a route or grant an action.

| Route key | URL / params | Center | Required action | Deep-link rule |
| --- | --- | --- | --- | --- |
| `rd.apps` | `/rd/apps` | RD | `app.read` | list only scoped applications |
| `rd.app-detail` | `/rd/apps/:appId` | RD | `app.read` | scope-out and missing both return 404 |
| `rd.environment-detail` | `/rd/apps/:appId/environments/:environmentId` | RD | `environment.read` | both IDs must refer to the same visible projection |
| `ops.cmdb` | `/ops/cmdb` | Ops | `ci.read` | list/filter scope is pool-or-project visibility |
| `ops.ci-detail` | `/ops/cmdb/:ciId` | Ops | `ci.read` | scope-out and missing both return 404 |
| `ops.topology` | `/ops/topology` with optional `ciId`, `environmentId`, `mode`, `depth` query | Ops | `ci.read` | exactly one visible root when a root is supplied |
| `search` | shell-owned search surface | current Center | entity read action | result routes must be registered and visible to the current identity |

Existing `/rd`, `/ops`, `/admin` and `/guide` remain real M0 routes. Admin receives no new M1 placeholder page. A cross-Center CI link keeps the canonical `ciId`; if the current identity lacks the destination Center/action it returns 403, while an authorized Center with an out-of-scope entity returns 404.

## Shared projections and scope

Application, Environment, CI, Relation and Placement always reference canonical domain IDs. RD and Ops receive policy-filtered projections of the same entities, never role-specific entity types or duplicate releases. A shared CI may appear in multiple visible environment placements, but pool capacity aggregates distinct canonical CI IDs exactly once.

Every list filters before pagination and `total`. Detail, search, graph, capacity aggregate and audit reuse the same visibility predicates. RD Commerce must receive empty list/search/graph/aggregate/audit results and 404 details for Data-only entities. Topology removes hidden nodes and incident edges before returning a result; `truncated`, node/edge counts and depth may describe only the visible result and must not reveal hidden counts. Relation audit records retain both endpoint CI IDs solely for authorization; historical reads require both current endpoint projections to be visible and otherwise return no record.

Unauthenticated requests return 401. A missing Center/action returns 403. A missing or scope-out entity returns the same 404 envelope. Validation is 422, canonical identity/idempotency conflicts are 409. Responses remain `Cache-Control: no-store`.

## Query families and invalidation

All keys are prefixed by `[sessionId, identityEpoch, policyVersion]`; filters must be canonical serializable values.

| Family | Shape after identity prefix |
| --- | --- |
| applications | `['applications', projectScope, filters]` |
| application detail | `['application', appId, null]` |
| environment detail | `['environment', environmentId, null]` |
| CI list | `['cis', scope, filters]` |
| CI detail | `['ci', ciId, null]` |
| relation list | `['relations', ciId, filters]` |
| topology | `['topology', rootDescriptor, {mode, depth}]` |
| search | `['search', centerScope, {q, limit}]` |
| capacity | `['capacity', poolScope, filters]` |
| audit | `['audit', entityScope, filters]` |

Persona/reset/generation/policy changes cancel in-flight queries and clear the entire client cache before rendering the new identity. CI create invalidates CI lists, search and capacity. CI metadata update invalidates that CI detail, CI lists, search, topology roots containing its changed ID, relevant application/environment projections, capacity and audit. Relation create/delete invalidates both endpoint relation lists, topology for both endpoints and affected environment roots, and audit. Invalidations occur only after a committed receipt; stale or failed commands cannot optimistically change domain state.

## Commands and receipts

All commands require a valid `Idempotency-Key`; an uncertain retry reuses the original key and request identity. Reusing a key with another payload returns 409. Update/delete commands carry the target `expectedVersion`; relation creation guards both endpoint versions. Stale versions return 409 without partial entity, event, audit, counter or persistence changes.

A successful receipt reports correlation ID, primary entity ID/version and `changed[]` canonical entity references. The same transaction writes the corresponding audit event with actor, action, correlation ID and safe diff summary. CI metadata editing may change only allowed metadata and never the canonical identity tuple. Manual onboarding validates canonical uniqueness and provider/account/location/pool compatibility before commit.

## Required UI states

Loading does not render zero-valued summaries. Empty is a successful scoped result with zero items. Unknown is a real nullable/unknown domain value and uses text plus a non-color cue. Numeric zero is rendered as `0`, never as unknown. Stale includes data-as-of/observed-at context and a visible stale label. Forbidden uses the 403 Center/action state; missing/scope-out detail uses 404. Conflict shows the 409 message and supports refetch/retry; validation associates 422 field errors with controls. Dialogs trap focus, close by Escape where safe and restore focus. Topology always has a keyboard-accessible table fallback and a visible truncation notice when visible caps are reached.

## Topology limits

Dependencies traverse outgoing relations; impact traverses reverse relations. Breadth-first traversal terminates on cycles with a visited set. Depth is at most 3 hops; returned visible results are capped at 100 nodes and 200 edges. Reaching either cap sets `truncated: true`; truncation never reports hidden node or edge quantities.

## Seed and ownership

Core seed owns organization, people, grants, session and navigation. CMDB seed owns provider accounts, locations, pools and exactly 60 baseline CIs: 20 AWS, 20 Aliyun and 20 on-prem. Application seed owns applications and environments. Topology seed owns placements and relations. Cross-feature references use exported deterministic ID constants/builders; builders may not import another feature's private state. The shared Redis CI is one canonical object referenced by multiple placements. M1 snapshots use seed compatibility ID `dim-gate-m1-v1`; the storage key remains stable so an older milestone snapshot is detected, preserved, and offered explicit reset or memory recovery rather than silently loaded or erased.

T-007 exclusively owns domain schemas/engine/policy/integrity and shared seed/contracts during foundation implementation. T-008 owns RD application UI and its feature client/tests. T-009 owns Ops CI UI and its feature client/tests. T-010 owns topology UI/algorithm client tests. Workers do not edit `.team/PLAN.md`, central route registry, `AppRoutes`, `AppShell`, API/demo composition roots, generated OpenAPI, global CSS, E2E, workflow or this contract. The orchestrator alone integrates public exports/routes/handlers, global search, cross-Center navigation, final scope isolation, generated artifacts, full E2E and acceptance records.
