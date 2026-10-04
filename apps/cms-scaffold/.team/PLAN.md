# W3 Front public delivery

Status: LOCAL_VERIFIED — required remote CI and publication pending. Baseline: BW5 merged PR #267; source c5fe7385 (CMS unchanged since BW5). Existing worktrees and nine baseline snapshots remain protected.

## Objective and design
Implement approved W3 public sites: album/photo/lightbox, clinic/vets, projects/milestones, responsive shell, registry, safe Markdown, SEO and loading/empty/error states. W3 section 0 reconciles current integrated contracts and gates before implementation. No member UI, Admin rewrite, backend changes, deployment or production-readiness claim.

## Bounded routing
- T-921: Codex high, isolated production Front implementation, approved W3 code as baseline with existing fixes preserved.
- T-922: Codex high, isolated Front tests and mock E2E, Red evidence before implementation, final verification after root integration.
- T-923: independent smaller Codex reviewer, read-only integrated source/evidence audit.
- Root: plan/docs, dependency and Breadcrumb integration, diff review, tests, responsive artifacts, acceptance, publication and handoff.

## Acceptance gates
- All required W3 behavior and regression scenarios pass; fixture/runtime-contract bytes and unrelated surfaces preserved.
- npm ci; gen freshness; lint; typecheck; npm test; build; test:bundle; e2e:mock; local ./gradlew test; remote integrationTest plus java/web CI.
- Rendered desktop/mobile evidence, browser health, safe public requests, keyboard lightbox/Sheet and no draft disclosure.
- Task/report validator, diff check, snapshots/protected hashes, independent reviewer, exact source evidence.
- Owner authorized commit→push→PR→required CI→exact-head merge→remote ancestry/tree check. No release/deploy.

## Decisions and progress
- Documents updated before code; BW5 publication closed with verified receipt.
- Historical W3 media/codegen changes already satisfied; preserve current sources.
- Existing react-markdown version reused as approved by W3; no new package version or dependency family.
- Worker scopes accepted with visible evidence; final independent review confirms the dependency closeout.

- Local Java: 339 tests, zero failures/errors/skips (test executed; compilation restored from cache). UI 18 tests passed; runtime codegen regeneration unchanged.
- Independent reviewer identified Radix missing lightbox close-focus target; T-922 supplies Red and T-921 fixes within original scope.
- Owner explicitly authorized the direct react-markdown declaration. Front manifest and lock each add one line; all locked package/version data unchanged. Clean install, gen, lint/typecheck, API32+Front87, build/bundle passed. Prior review rejection is resolved.

- T-921 accepted for scoped production lint/typecheck/build, T-922 accepted for scoped 87 unit and 21 browser checks; root verified exact hashes/diffs.
- Root gates: 339 Java, 473 frontend, 60 mock E2E; final Front87/lint/typecheck/build/bundle after interaction fix; Front build/bundle and CDP health after favicon-only HTML correction.
- 15 responsive captures, zero final blocking browser findings. Original animation/cold-start/favicon findings are recorded and resolved.
- T-923 independent technical review confirms focus and dependency fixes. Local acceptance complete; final publication still requires remote CI and exact-head merge.
- No W3 Git publication. Final progress and required continuation are documented in W3-DELIVERY; owner standing Git authorization remains valid.
