# W1 integration contract

Revision 1 · 2026-09-23 · Base `7a7b41b2e74c2c635642dcb6c980363f6958968b` · WS-SDD revision1.

## Scope and acceptance

REQ-WS-01/09/10, AC-WS-01/02/16/17/18. Deliver a prominent workspace selector independent from Demo persona, current-workspace-only grouped navigation, and distinct RD/Ops/Admin homes backed by existing shared domain entities. Preserve all public routes, v0.1 business transitions, scope denial, Admin execution restrictions and 300 KiB initial JS budget. W2–W5 capabilities stay unavailable until separately delivered.

## Wire and selector contract

Keep GET `/dashboard` and its existing counters/pendingItems/dataAsOf. Add required `workspace`, a discriminated union on `kind` (`rd|ops|admin`), plus `scope` options/filters. No new operation or business command.

- Query: center, projectId?, environmentId? plus provider?/poolId? for Ops. Unknown keys/enums return422. Scope filtering precedes counts/rows; foreign scope returns empty data without names/counts of hidden entities. An environment must match selected project. Pool must match provider. No filter silently ignored.
- `scope`: projects `{id,name}[]`, environments `{id,name,applicationId}[]`, pools `{id,name,provider}[]`, filters `{projectId?,environmentId?,provider?,poolId?}`. Options are authorized; environment options reflect selected project; pool options reflect provider.
- Shared home section: `{title,total,items}`; at most20 deterministic items, explicit total of the authorized filtered result. Shared item: `{sourceType,sourceId,title,state,route,dataAsOf,detail}`. sourceType is application/environment/request/release/job/incident/pool/ci/catalogItem/integration/auditEvent. Safe detail text, canonical IDs, registered legal routes only; no raw logs, traces, secret payloads or arbitrary links. Lists are projections, never persisted business state.
- RD workspace: `{kind:'rd',services,work,deliveries}`. Services are visible environments with application identity, latest observation freshness/health (missing samples=unknown, stale never healthy), ready/deployment state. Work uses existing draft/submitted/approved/failed requests and pending releases; deliveries use actual recent release history. No synthetic success statistics.
- Ops workspace: `{kind:'ops',incidents,failures,approvals,capacity,staleness}`. Order critical incidents, failed jobs/releases, actionable pending requests/releases, physical pool capacity, stale/unknown CIs. Project+pool intersection and non-self approval determine actionable work. Physical capacity counted once; requests have no environment until provision. Provider/pool filters restrict linked environments/requests/releases/incidents to matching existing resources or request targets; no unseen consumers leak.
- Admin workspace: `{kind:'admin',drafts,integrations,accessChanges}`. Actual draft catalog revisions, safe integration health/error/stale metadata, safe recent access audit. No invented W5 feature/notification records and no business execution actions.
- API client accepts optional typed dashboard filters. Full filters plus identity/policy are in query key. Existing response epoch guards remain authoritative.

## UI and design brief

Keep established system fonts, indigo tokens, semantic controls and 1440/768/390 layout. Lead with workspace name and task: RD service health/delivery; Ops prioritized duty queue and capacity; Admin configuration and integration work. Show data time on every section/item; explicit empty/loading/error/stale states. Workspace control stays visible even for a single grant; no grant shows no authorized workspace plus separate Demo entry. Persona label remains accessible as `示範身分`, visually identified as `Demo · 體驗其他角色`, and always describes identity change.

Navigation uses registry defaults to group legacy uncustomized seed metadata without rewriting persisted navigation. Admin-edited group/order/label/enabled retain precedence. Recovery Guide remains reachable. Workspace is presentation state derived from legal route and per-identity UI preference; never changes user, policy, domain, command count or snapshot. Cross-center read-only diagnostic pages retain source workspace with a back link and an explanation; explicit selector changes navigate to target home. Preserve legal project/environment across compatible workspaces; clear unsupported scope with visible explanation. Home scope lives in URL so browser Back/reload retains it. Row drilldowns target the same canonical entity; returning by browser Back preserves home filters.

## Compatibility and fixtures

No domain snapshot/schemaVersion/seedVersion/IDs change in W1. Existing M4-v1/v0.1 snapshots, active jobs, audit and receipts load untouched. Test multi-grant and zero-grant personas through existing Admin access commands/UI against existing users; do not mutate browser store to create these success cases. W2 adds persistent fixture/schema changes under its own migration contract. Failure scenarios reuse api-unavailable, held old responses, revoked grants, corrupt/quota storage and running execution reload.

## Ownership, affected specifications and gates

T-030 worker owns `src/domain/schemas.ts`, `src/domain/engine.ts`, new `src/domain/workspace-home.ts`, `src/domain/w1.test.ts`, `src/api/contracts/core-session.ts`, `src/api/clients/cmdb.ts`, `docs/openapi.json`, focused `src/demo/w1-handlers.test.ts`. It alone edits shared schema/engine during this slice. T-031 lead owns Shell, registry, home UI, CSS, client/component/browser tests, documentation and all task/report/PLAN, integration and Git. No worker changes seed, policy, controller, manifest, lockfile, router, CI or sibling component. Lead owns router/manifest/CI exclusively. T-032 reviewer is uninvolved, read-only against a fixed candidate.

Affected baseline: SDD01 sections2/3/5 (selector/group/home), SDD04 section2 (workspace versus identity), SDD05 sections3/4/5/6 (query/preference/unchanged persistence/performance), SDD06 section3/dashboard DTO, SDD07 existing regressions plus SDD14 W1 AC. All updated in this PR. Mock continues through the common engine/handler; generated OpenAPI must match Zod. No new dependency.

Required: frozen install; lint; typecheck; test; check:docs/contracts/ci/architecture; clean demo build; full existing Chromium regression plus W1 real UI role/scope/denial/refresh/old-response/keyboard paths; light/dark axe and screenshots1440/768/390; Firefox/WebKit smoke; benchmark; isolation; diff check; pinned teamctl task/report checks; uninvolved fixed-commit review; latest PR-head CI; authorized SSH push/PR merge and merge-tree/post-merge CI reconciliation. Preserve failures and attempts. Each task at most three review cycles, one same-cause rework before changing approach. W1 is accepted only with all exit gates; user requires sequential W1 merge then W2 etc.
