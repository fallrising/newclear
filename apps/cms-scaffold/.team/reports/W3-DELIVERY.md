STATUS: PARTIAL

## Summary

Project: CMS Scaffold — W3 Front public sites. Public album/photo/lightbox, clinic/vet, project/milestone pages, responsive site navigation, registry, safe Markdown, loading/empty/error states, SEO and logout are implemented locally. Eight existing App regressions remain. BW5 publication is closed as VERIFIED with PR #267 evidence.

Local acceptance is complete (LOCAL_VERIFIED); this pre-publication checkpoint remains PARTIAL until required remote CI and merge. The owner explicitly authorized Front's direct react-markdown 10.1.0 declaration. Both manifest and lockfile now declare it; clean installation verifies it. Removing that one Front lock entry makes the entire lockfile identical to baseline, so no package/version drift occurred. The previous automatic-review authorization blocker is resolved. No deployment is authorized.


## Verification

| Command / evidence | Observed result |
| --- | --- |
| `npm ci` | Passed again after the authorized Front-only lock entry |
| `npm run gen -w @cms/api` | Passed; generated source unchanged, runtime OpenAPI equals BW5 contract |
| `npm run lint` | Passed; final run after lightbox fix |
| `npm run typecheck` | Passed; final run after lightbox fix |
| `npm test` | 473 passed: API 32, auth 43, fields 61, mocks 92, UI 18, Admin 7, Back 133, Front 87 |
| `npm test -w @cms/web-front` | 87 passed again after the two-file lightbox correction |
| `npm run build` and `npm run test:bundle` | Passed after lightbox correction |
| `npm run build -w @cms/web-front` and `npm run test:bundle` | Passed after the subsequent favicon-only HTML correction |
| `./gradlew test --no-daemon --no-parallel --console=plain` under JDK 25 | 339 tests, zero failures/errors/skips; test executed, compilation used cache |
| `npm run e2e:mock` with browser runtime environment | 60/60 passed, no exclusions, 2.7 minutes; includes all prior 39 and new 21 |
| Worker Front browser suite | 21/21 passed, including keyboard/URL/focus/background regressions |
| Responsive Chromium capture and skill runner | 13 route/modal/menu captures plus 2 clinic runner captures; no final blocking findings |
| Hash/scope review | 439 source files; 377 protected files unchanged; 19 production and 13 test worker hashes verified |
| Preservation | Nine immutable baseline snapshots and original 468-file delivery preserved |
| Task/report validator and `git diff --check` | Passed; independent final source/dependency review recorded in T-923 |
| Post-dependency npm install/ci/ls/gen/lint/typecheck/test/build/bundle | Passed; API 32 + Front 87 = 119 tests; no app-code or locked-package drift |

- Native local commands and visible counts in the table above — passed
- Protected/source/worker hash checks and preserved baselines — passed
- Direct dependency declaration, clean-install consistency and proportionate regression checks — passed
- Required remote CI and merge at this pre-publication checkpoint — skipped

[Post-dependency gate exits](../evidence/w3-dependency-gates.json), [exact lock comparison](../evidence/w3-dependency-check.json) and [dependency hashes](../evidence/w3-dependency-manifest.json) record the final authorized change. The prior full local 473-test and 60-E2E evidence remains applicable because package versions and application sources did not change; remote web CI will repeat the complete gates.

Full local logs are ignored; [log hashes](../evidence/w3-log-manifest.json), [gate exits](../evidence/w3-final-gates.json), [source hashes](../evidence/w3-source-manifest.json), [verification summary](../evidence/w3-verification-summary.json), [protected hashes](../evidence/w3-protected-manifest.json), [preservation](../evidence/w3-preservation.json) and [browser hashes](../evidence/w3-browser-manifest.json) bind the observations. [T-921](T-921.md), [T-922](T-922.md) and [T-923](T-923.md) give scoped implementation, test and independent review evidence.

Local PostgreSQL/performance suites were not repeated: no backend/schema/build dependency changed. The unchanged BW5 baseline has 140 PostgreSQL tests and three passing performance runs; this is inherited evidence, not a new W3 run. W3 remote Java/integration/web CI remains pending a complete change and PR. Real-API E2E, release and deployment were not performed.

## Documentation

W3 section 0 was written before implementation to reconcile the old rehearsal with current BW5 contracts and current native gates. The design follows the approved dark gallery, warm clinic and neutral projects schemes, 1200px desktop content, mobile Sheet and keyboard navigation. No new UI kit, font or external asset was introduced. The only root-owned HTML addition is a local inline SVG favicon to resolve a real browser 404.

Independent review found that the historical controlled Dialog had no close-focus target. Two browser Reds established lost focus and a full-screen blank background that would not dismiss. The narrow album/lightbox correction restores the origin tile through arrow navigation, handles direct-link fallback, and dismisses only empty image-container space. Image and control clicks remain open. Final tests cover these behaviors.

Visual inspection of the selected desktop/mobile selector, clinic, project, album, photo, lightbox and menu captures found readable hierarchy, visible focus, correct reflow and no clipping. Mock media are deliberately 64×64 solid images; this evidence does not represent production photography. The skill runner records small inline-link/button target advisories, without blocking findings. Initial captures caught animation transitions; final screenshots finish finite animations. The initial cold runner also found favicon 404 and a not-yet-loaded desktop title; the favicon was fixed and the final runner uses explicit readiness prewarm. See [historical browser findings](../evidence/w3-browser-initial-findings.json).

Five existing differences between mock and historical contract fixture directories remain unchanged from BW5: admin-content-types, capabilities, principals, work-content-types, work-entries. Both trees are hash protected; no fixture or authorization behavior was overwritten to satisfy the old rehearsal's equality assumption.

## Risks and Follow-ups

Required next action: complete the already-authorized commit → push → PR → required Java/integration/web CI → exact-head merge → remote verification. Do not ask again for these steps. The direct dependency authorization/declaration and local verification are complete.

`npm audit --json` exits 1 with the inherited transitive brace-expansion high-severity advisory. This optional observation is explicit, not a passing gate; the locked dependency graph is unchanged and no automatic upgrade was made. It was already recorded in W2. See [audit evidence](../evidence/w3-dependency-audit.json). This is not a production-readiness sign-off.

Historical failures remain explicit: intended route/lightbox Reds; one old empty-state test selector adapted to W3; one concurrent test-readiness timeout passed unchanged in isolation; optional unconfigured Prettier comparison warned, while native lint passed; an initial worker patch artifact selected the wrong spec block and was corrected without changing production files. No threshold or behavioral assertion was weakened.

W3's accepted scope limits remain: public photo walls show at most 100 photos, static navigation/view-pack enum labels, SPA metadata without prerender/sitemap, and bundle budget hardening deferred to W5 (current Front main gzip about 144 kB). Next proposed feature milestone after W3 publication is W3b Front member area; it is not started. No production-readiness claim.
