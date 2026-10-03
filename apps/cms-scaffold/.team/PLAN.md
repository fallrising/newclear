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

## BW1b — active local continuation

Owner requested continued development. Baseline is locally verified BW1a (151 Java +65 PostgreSQL +140 frontend +17 mock E2E), preserved in a local file snapshot before changes. No new external mutations authorized. Documentation §0 precedes implementation and preserves P0/BW1a plus complete-list consumer compatibility.

- T-301 Codex high: index/store/query/value objects, V6/V7/backfill/performance and store regressions. Keep legacy list methods until service integration is ready; remove them as final integration step.
- T-302 Codex high: parser/predicate/access policy and HTTP/service paging; consume reviewed T301 objects/store interfaces before full checks. Preserve P0 transactions and BW1a caches.
- T-303 Codex medium: generated API/client/MSW and existing complete-list consumers, with focused Red→Green tests. No UI redesign.
- Lead: bounded public-spec CLI review, dependency imports, complete diff review and final integrated gates, report actual 10k timings. Use codex-evidence-gate before acceptance.

Independent worktrees receive identical BW1a snapshots; no worker commits or recursive delegation. Root .team remains untouched. New delivery delta is measured against the preserved snapshot, not just git HEAD (which is P0).

## BW1b acceptance — LOCAL_VERIFIED (2026-10-03)

- [x] T-301 DoD: atomic indexing/query/backfill, P0 CAS/rollback preserved; scoped diff review and 202 unit/API +91 PostgreSQL final root XML support acceptance.
- [x] T-302 DoD: parser/access/controller/schema behavior, Red→Green history and final integrated Java checks accepted; runtime OpenAPI equals BW1b contract.
- [x] T-303 DoD: generated client/MSW/complete-list behavior, Red→Green and final 166 frontend +17 mock E2E accepted; lint/typecheck/build/bundle pass.
- [x] Required checks mapped in reports/BW1b-DELIVERY.md; final backend log includes bootJar, 9 executed tasks, zero failures/errors/skips. Store p95 work/public/patch 85/77/18ms preserves thresholds.
- [x] Independent T-304 evidence reread and codex-evidence-gate closure; no full rerun for documentation-only changes.
- [x] Portable documentation/status updated; task/report contracts and diff whitespace checked; BW1a snapshot and protected dependency/V1–V5 files preserved.

Task-file unchecked DoD bullets remain the immutable assignment contract because teamctl requires them; completed acceptance boxes are recorded above. Historical worker Red/intermediate failures remain in reports, while resolved pending root gates now cite final evidence. BW1a/BW1b remain uncommitted/unmerged; P0 #212 is the last merged wave. No deployment or production readiness claim. Separate BW1b delta is recorded against the preserved BW1a snapshot; BW1c starts only after this closure.

## BW1c — documentation ready, local implementation

BW1b acceptance is closed before this wave. New immutable BW1b snapshot isolates the BW1c delta; existing BW1a snapshot remains untouched. docs/v2/waves/BW1c.md §0 supersedes stale historical patches before any code writes.

- T-401 Codex gpt-6.1-sol high: pure PayloadValidator, FieldError types and unit regression scope in isolated validator worktree; send interface readiness to lead.
- T-402 Codex gpt-6.1-sol high: service/error/API/media-null and backend regressions in isolated service worktree; lead imports reviewed T401 files as read-only dependency. Preserve P0/BW1a/BW1b.
- T-403 Codex gpt-6.1-sol medium: generated client/MSW/consumer compatibility in isolated web worktree, focused Red→Green and frontend gates.
- Lead: documentation, routing, scope/diff review, final native backend/frontend gates and evidence-gate acceptance. Lightweight independent Codex Luna audit follows integration; no third-party CLI export of unreleased sources.

Final gates: backend test/integrationTest/bootJar with uncached tasks; frontend lint/typecheck/test/build/bundle/mock E2E; runtime BW1c OpenAPI equality; dependencies/migrations unchanged; task/report validation. Failed and skipped checks remain explicit. No commits, push, merge, deployment or production-readiness claim.

### BW1c review record

T-401 accepted in bounded scope after direct source review and XML 15/0/0/0. The historical sample duplicated reserved metadata errors; a behavioral Red observed six errors versus three, and reported-key tracking fixed it. T-402 adds 428 before payload validation and leaves transaction/CAS wiring intact; root inspected legacy DB regressions and existing assertion-preserving version adaptations. T-403 review found Date.parse normalization/minute-precision differences, media UUID shorthand and disabled-field projection gaps; targeted regressions fixed them before root integration. T-404 independent Codex Luna backend review found no concrete defect; final evidence acceptance follows root gates.

Root independently observed frontend chain exit 0: lint/typecheck, 179 tests, build/bundle and 17 mock E2E (24.8s). Backend combined gate subsequently passed as recorded below. Scope comparison confirms 27 dependency/migration/store/index files unchanged; all 304 gate source fingerprints unchanged after launch. BW1b original complete logs/XML were preserved before the new gate.

## BW1c acceptance — LOCAL_VERIFIED (2026-10-03)

- [x] T-401 DoD accepted:15 focused unit tests and meaningful reserved-key Red→Green; final root coverage includes these tests.
- [x] T-402 DoD accepted:226 unit/API,17 focused DB tests; root final93 PostgreSQL covers both new legacy cases plus all prior contracts/migrations/performance. Existing assertions preserved with actual-version inputs.
- [x] T-403 DoD accepted: required-version client, retained fields, MSW parity and existing forms; final179 frontend +17 mock E2E, lint/typecheck/build/bundle all pass.
- [x] T-404 read-only independent backend review and final evidence audit accepted; no concrete defect;304 source fingerprints match.
- [x] Root combined backend gate exit0 in4m36s,226/93 tests and bootJar; all required final checks zero failures/errors/skips. 10k store p95 work75/public77/patch22ms within150/100/80ms.
- [x] BW1c runtime OpenAPI equals docs contract; no raw media fallback;27 protected dependency/migration/store/index files unchanged; original BW1a snapshot intact.
- [x] README/readiness/wave/roadmap updated; report/task validators, relative links, delta manifest and whitespace review completed. Exact commands/artifacts in reports/BW1c-DELIVERY.md.

Task DoD assignment bullets remain unchanged for teamctl's unchecked-contract requirement; completion is recorded in the acceptance boxes here. BW1a/BW1b/BW1c remain uncommitted/unmerged and the next roadmap wave is W1. No new PR, push, merge or deployment; local acceptance is not production readiness. Preserve both earlier snapshots and frozen BW1b evidence/delta when reviewing the combined working tree.

## BW1 publication authorization — 2026-10-03

The owner explicitly authorized committing, opening and merging one PR per completed BW1a/BW1b/BW1c wave, then continuing development. Earlier local-only statements record acceptance-time history. This publication is reconstructed from preserved per-wave snapshots; original dirty worktrees remain untouched. Required remote CI must pass before each merge. No deployment is authorized. No private tracking contents are published or modified.

## W1 — documentation-first continuation

Owner authorized five new runtime packages at the pinned W1 versions after authorizing BW1a/BW1b/BW1c PRs and merges. W1 section 0 overrides stale whole-file replacement instructions before code. Original integration tree and three immutable snapshots remain preserved; W1 uses a new isolated integration worktree. W1 is local development only; no deployment.

- T-501 Codex high: shared UI components/patterns and typed fields; preserve old exports/tests. Isolated worker, no manifests.
- T-502 Codex high: incremental API/auth/MSW support and focused regressions. Preserve BW1abc pagination/validation and all current tests. Isolated worker.
- T-503 Codex medium: capability navigation, resource index/editor, custom-view copy and mock E2E; preserve/migrate P0 behavior tests. Isolated worker, consume reviewed T501/T502 files without ownership.
- Orchestrator: manifests/lock, document decisions, scoped integration, tests/build/bundle/browser evidence and acceptance. Independent cheaper Codex review after integration. No recursive delegation; at most three concurrent workers.

Dependencies: all BW1 remote gates and merges before implementation; root npm install before worker environment setup. T501/T502 publish interfaces early; T503 can implement against documented interfaces but cannot claim green before dependent integration. Root checks each diff against explicit scope before copying.

Acceptance gates: focused Red→Green; retain source protection and meaningful P0 tests; full frontend lint/typecheck/test/build/bundle; mock E2E including W1 and axe; desktop/mobile browser health; Java test and referenced unchanged-backend PostgreSQL evidence; contract equality; task/report validators and diff review. Historical counts are not acceptance targets. Failures/skips stay explicit until resolved.

BW1 publication closed: PR #223 (`7b29dce`), #224 (`a15e550`) and #225 (`d87f54d`) merged with java/java-integration/web/trailer all successful; see reports/BW1-PUBLICATION.md. New work begins from merged main. Root verified the five npm versions and no pre-existing external package version changed; existing dev-transitive brace-expansion advisory remains. Copied shadcn components retain upstream MIT notice in packages/ui/LICENSE.shadcn.md.

## W1 acceptance — LOCAL_VERIFIED (2026-10-03)

- [x] T501 accepted: UI17 + fields49, preservation Red→Green; final root visual/CSS correction also covered by computed-style E2E.
- [x] T502 accepted: API30/auth43/mocks59, inherited53 mock tests retained; cached401/500 session protection and baseline fixture preservation.
- [x] T503 accepted: Back86, migrated18 P0 cases, full root27 E2E plus responsive captures; historical failed label/environment runs retained.
- [x] T504 independent cheaper Codex source/evidence audit found no concrete defect; manifests and browser findings checked.
- [x] Root full frontend chain300 tests/lint/typecheck/build/bundle,Java226; final affected builds/bundle/full27E2E and browser health repeated after favicon/CSS fixes.
- [x] npm ci reproduced the authorized lock; subsequent all-app build/bundle passed. Source362/protected190 hashes remain valid; original tree and snapshots intact.
- [x] Documentation/report validators and diff/new-file hygiene closed; W1 remains uncommitted/unmerged, no deployment.

Root visual review found missing fields Tailwind scanning (documented then focused expected Red0px→Green128px) and favicon404. Corrected incrementally without changing runtime dependencies or thresholds. CJK font/browser library gaps were repaired in temporary local runtime only. Small-touch-target advisories remain. See reports/W1-DELIVERY.md for exact commands, mappings and residual limits. The next product wave follows the roadmap; no further implementation is claimed here.

## W1 publication authorization — 2026-10-03

Owner requested saving the verified W1 progress to GitHub and continuing the next roadmap task. Publish W1 as one PR and merge only after CI passes; do not deploy. Existing LOCAL_VERIFIED reports describe the earlier local acceptance. BW2 follows W1, with incremental documentation and isolated bounded workers before implementation.
