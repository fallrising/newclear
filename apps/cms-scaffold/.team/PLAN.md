# CMS personal-use delivery

Owner: Codex orchestrator. User authorization: documentation first, then local development with a cost-aware multi-model team. Initial scope was local only. The owner subsequently authorized publishing and merging the P0 PR, then continuing development. Deployment remains unauthorized.

Baseline: newclear 82cd9d8, apps/cms-scaffold. The archived standalone repository is historical. BW0 and W0 exist; other waves are specifications, not implemented features. Preserve all unrelated working trees.

## Sequence and scope
1. Inspect current code and upstream satnaing/shadcn-admin; document an explicit P0 reliability wave and reference mapping before implementation.
2. Review the specification, then dispatch disjoint isolated workers: T-101 content transactions/concurrency (Codex); T-102 form value safety (Codex); T-103 independent document/design review (Grok fast or Gemini Flash).
3. Integrate diffs without commits; independently review and run backend test/integrationTest plus frontend lint/typecheck/test/build/test:bundle/e2e:mock.
4. Record exact evidence, skips, remaining production readiness work. P0 is not completion of all v2 waves or production certification.

## Model routing
Codex primary reasoning and data integrity. Use available CLI model listings, not remembered names. Prefer bounded fast reviews; at most three workers and no recursive delegation. Read-only external reviewers cannot mutate code or call other agents. Initial discovered candidates: grok-4.7-build-fast; agy gemini-3.8-flash-medium; cursor composer-2.5 or claude-sonnet-5-5-medium. Do not use all providers merely to fill seats.

## Acceptance gates
- [x] P0 document ready before implementation; historical/reference assumptions corrected.
- [x] Backend rollback and concurrency regressions pass against PostgreSQL.
- [x] Frontend typed values, clearing fields, conflict retention and pending state regressions pass.
- [x] Required repository checks run and outcomes recorded.
- [x] Independent review resolved; scope/diff reviewed; no unapproved dependencies or external mutations.

## Review-driven P0 correction
Independent code review found media public authorization used the working attachment index without matching publishedPayload media ID. P0-DATA extended before implementation: index work/published union; public authorization exact published media ID and enabled type; lifecycle/revert isolation regressions. No API/dependency/schema expansion.

## Acceptance — 2026-10-03
P0 accepted as LOCAL_VERIFIED only. All four task/report contracts validate. Orchestrator independently reran final integrated Java gates without cache (114 unit/API + 60 PostgreSQL tests), frontend gates (133 tests), mock E2E (17), and Chromium desktop/mobile form checks. Required final checks have no failures/skips. Initial browser missing-library failure was resolved with existing local libraries; Grok review was not accepted and Gemini/Claude supplied bounded independent reviews. Detailed evidence and residual production work: reports/DELIVERY.md. No commits, pushes, deployment, new dependencies, or external mutations.

## Publication authorization
The owner explicitly requested merging the P0 PR, then continuing development. No P0 PR existed, so prepare the scoped commit and PR, wait for CI, and merge it. This session instruction supersedes the earlier local-only boundary. It does not authorize other projects’ PRs or deployment. Machine-specific paths in published evidence are replaced by descriptive environment variables; original raw logs remain local.

## BW1a — active delivery

P0 PR #212 merged at 10a4c8d after java, java-integration, web and trailer CI passed. Owner requested continued development. This phase implements BW1a plus the mechanical W0 contract synchronization defined in BW1a §0; no deployment or further merge inferred.

1. Amend BW1a integration contract before code; preserve P0 invariants and require every frontend gate green.
2. T-201 Codex high: type settings, fields, V5, stores, seed, visibility/order and associated regressions; isolated data worktree.
3. T-202 Codex medium: capabilities/cache, API projections/controllers/OpenAPI and regressions; isolated API worktree. Imports reviewed T-201 input before full verification, never edits T-201 scope.
4. Orchestrator: generated TypeScript and mock/test fixtures only, review/integration and all final gates.
5. External Grok fast, Cursor Composer and OpenCode Luna review public specification excerpts, no editing/delegation; outcomes and limitations recorded separately.

Acceptance: required Java, PostgreSQL and frontend checks all pass; P0 preserved; contract file equality; metadata/search/capabilities/cache tests; bounded worker reports validated; diff contains no new dependencies or unrelated edits. Remaining production operations stay deferred.

## BW1a acceptance — LOCAL_VERIFIED

- [x] BW1a §0 documented before implementation, including P0 preservation and green frontend integration.
- [x] T-201 accepted after source review and final 128/65 worker tests; latest assertions imported.
- [x] T-202 accepted after source review, review-driven AuthService cache Red→Green and 150/65 worker tests.
- [x] Grok/Cursor/OpenCode final review text examined; concrete findings integrated, unsupported/speculative findings explicitly disposed in T-203.
- [x] Orchestrator final integrated backend: 151 unit/API +65 PostgreSQL tests, zero failed/errors/skipped; bootJar passed; 9 tasks executed without cache.
- [x] Frontend lint/typecheck/test/build/bundle +17 mock E2E passed; 140 tests, including 7 new compatibility regressions.
- [x] OpenAPI exact equality, dependency/migration scope, diff review and team contract validation complete.

Evidence: reports/BW1a-DELIVERY.md. No BW1a commit, push, PR merge or deployment; P0 merge is the only external repository delivery action authorized and performed. Remaining product phases and production operations stay explicitly pending.

## BW1 publication authorization — 2026-10-03

The owner explicitly authorized committing, opening and merging one PR per completed BW1a/BW1b/BW1c wave, then continuing development. Earlier local-only statements record acceptance-time history. This publication is reconstructed from preserved per-wave snapshots; original dirty worktrees remain untouched. Required remote CI must pass before each merge. No deployment is authorized. No private tracking contents are published or modified.
