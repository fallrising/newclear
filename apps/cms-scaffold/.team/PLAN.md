# CMS W3b — LOCAL_VERIFIED

Objective: deliver Front member dashboard, owned appointment detail/create, safe login return and clinic member controls. Docs first: W3b §0 updates merged W3/BW5 integration. Owner standing authorization covers commit/push/PR/required CI/merge/remote verification; no release/deployment/dependencies.

Baseline: main c247028e; CMS matches W3 #273. Existing worktrees/snapshots preserved; full source baseline outside worktree.

## Bounded routing
- T-931 Codex high: API + member mocks and scoped contract tests; isolated cms-w3b-api.
- T-932 Codex high: Front member production + Vitest acceptance and minimal affected regression updates; isolated cms-w3b-front; waits for T-931 frozen API patch.
- Root: docs, integration, eight Playwright tests, responsive evidence, full native gates, publication.
- T-933 smaller Codex independent review after integrated candidate, read-only sources and report only.

Workers may not delegate or publish. API and Front writable scopes disjoint; root only integrates frozen reviewed files. No runtime dependencies, backend or contract edits.

## Gates
- TDD: focused intended red then scoped green; preserve W3 regressions.
- Contract/runtime member operation/schema equality; fixture byte equality and owner isolation.
- npm ci, codegen freshness, lint, typecheck, all workspace tests, build, bundle, all mock E2E (expected 68), Java tests; PostgreSQL required CI.
- Desktop/390px member states, axe serious/critical zero, no overflow; safe next, session expiry, duplicate prevention, payload allowlist, no visible identifiers.
- Evidence gate maps each scope and check; independent review then exact-head required CI and merge.

## Acceptance
LOCAL_VERIFIED. T-931 and T-932 accepted after frozen diff/hash review; independent T-933 source/evidence review passed. Root gates: npm ci/codegen/lint/typecheck/546 tests/build/bundle,339 Java FROM-CACHE,68 E2E,20 browser captures and preservation all passed. No unresolved source or local verification blocker. Required remote CI/exact-head merge/remote verification still pending; no deployment or production readiness claim.
