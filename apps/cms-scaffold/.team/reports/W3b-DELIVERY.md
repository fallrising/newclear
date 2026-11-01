STATUS: PARTIAL

## Summary

W3b delivers the Clinic member area on merged W3/BW5: login/member menu, owned pets and appointments, appointment detail, and appointment creation. It resolves G-08, C-11 and surface-front AC-10–13, preserves AC-08 isolation, and checks V2-AC-14/15. The three member pages are noindex and use only the existing Front API subpath and generic `/api/v1/me/**` operations. No backend, runtime dependency, lock, other fixture, or unrelated application changes.

Submission validates an owned pet, a future local date/time and a trimmed reason. Success sets the detail cache, invalidates the appointment list, then replaces the Front route. 401 clears member data and returns to a pathname-only login target; 403 foreign records never expose content; field and rate-limit errors preserve form values and show product copy. Logout/login clear member queries; a late mutation after leaving or switching identity cannot restore old data or navigate. The public schema still excludes publication state; only the member parser reads it once.

This is the pre-publication checkpoint. Required remote CI, exact-head merge and remote verification remain pending; the final PR/handoff receipt closes publication. No deployment or production-readiness claim.

## Verification

- `npm ci`: exit 0, existing lock unchanged; `w3b-ci-install.log` — passed
- `npm run gen -w @cms/api` and `npm run gen -w @cms/mocks -- --check`: exit 0; API generated schema unchanged; typed fixture generator fresh — passed
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:bundle`: all exit 0; per-command records in `w3b-final-gates.json` — passed
- `npm test`: exit 0, 546 tests: API 41, auth 43, fields 61, mocks 111, UI 18, Admin 7, Back 133, Front 132; no skips — passed
- `./gradlew test --no-daemon --no-parallel`: exit 0, 339 tests with zero failures/errors/skips restored FROM-CACHE; backend sources unchanged — passed
- `npm run e2e:mock -- --grep W3b`: exit 0, exactly 8 tests; sixteen axe scans (8 states × 1440px/390px), zero serious/critical violations; keyboard and portal-theme regression — passed
- `npm run e2e:mock`: exit 0, all 68 tests passed in 2.8 minutes, no exclusions — passed
- `node .team/evidence/w3b-browser.mjs`: 18 state/menu captures, zero unexpected errors or overflow; intentionally injected 403/429 distinguished — passed
- `node .team/evidence/w3b-browser-runner.mjs "$BROWSER_EVIDENCE"`: official codex-ui-evidence CDP runner, 2 viewports, zero blocking findings — passed
- Root visual review of 8 representative desktop/mobile dashboard/detail/form/forbidden/validation/rate-limit/menu images: no clipping or hierarchy issue; 20 images total — passed
- Runtime BW5 member operations and three member schemas match exactly; member fixture byte-equal, source guard and bundle exemption exact — passed
- T-931 scoped implementation and independent API/mock audit: 41 API +111 mock tests; T-932 scoped 132 Front tests; reports and frozen hashes retained — passed
- Independent T-933 final source/evidence review found no unresolved issue; independent API/mock 152 and Front 132 checks, final diff check and report validation — passed
- Required GitHub java/java-integration/web CI and publication: awaits this accepted local candidate's commit and PR — skipped

All artifact names above are under `.team/evidence/`. Root verification script passed: 834 protected baseline files, 453 source hashes, member fixture equality, all 9 historical snapshots and the original 468 files preserved. Worker reports are [T-931](T-931.md), [T-932](T-932.md), and independent [T-933](T-933.md).

## Documentation

W3b §0 was updated before implementation for the real merged W3/BW5 baseline, Node 24 tooling, typed fixture generation, existing assertion changes, logout/cache isolation, late mutation protection and actual E2E inventory. W3's previous pre-publication state is closed by [W3-PUBLICATION](W3-PUBLICATION.md). Roadmap and `.team/PLAN.md` record actual acceptance states.

W3b T01–T04 map to the API/mock contract tests; T05–T10 map to the three new Front suites plus exact source/bundle guards and retained public regressions; T11 maps to the eight browser tests and responsive evidence; T12 maps to full native gates and final publication. W5 must retain the actual 68-test inventory rather than the superseded 47/92 estimates in older planning text.

## Risks and Follow-ups

- Remote CI and merge are still pending at this source checkpoint. PostgreSQL integration is a required CI gate; local Docker/integration/performance were not rerun because backend sources did not change. Real-API UI E2E remains non-gating and was not run.
- `npm ci` reports the previously recorded transitive brace-expansion high advisory. The graph is unchanged; no audit fix or dependency upgrade was mixed into W3b.
- The build warns about a 571.83 kB Front main chunk; the existing bundle guard passes. W5 owns the specified member lazy-boundary split.
- Deterministic mock create supports the fixture-declared success case only; other input cases are not new production restrictions. Runtime server behavior is unchanged.
- Resolved failures remain visible in hashed ignored logs: intended API/mock and Front Reds; initial stale client-key assertion and test fixture setup; one concurrent worker SEO timeout (unchanged full reruns green); root keyboard locator corrected to the required displayed member name; portal theme Red fixed from `clinic` to `clinic-warm`; official browser runner first failed on a missing local library path, then passed using the existing complete browser environment; preservation helper initially treated snapshot metadata as a source path, corrected to the historical manifest format with all hashes matching.
- Historical worktrees and BW1a onward snapshots remain preserved. No secrets or real user data added. Next planned feature wave: W4 Admin; it has not started.
