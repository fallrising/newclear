STATUS: DONE

## Summary

W1 is LOCAL_VERIFIED on merged BW1abc main (`d87f54d`). Back now has capability-based navigation/Home, URL-driven paged lists, typed grouped editing, changed-key/versioned saves, field errors, conflict reload, dirty navigation/beforeunload protection, status actions with confirmation and toast outcomes. Read-only references/media and unknown values remain preserved; existing custom views retain guarded allEntries behavior.

Documentation section0 preceded implementation. Three bounded isolated Codex workers delivered UI/fields, API/auth/mocks and Back/E2E; an independent cheaper Codex audit found no concrete defect. Root reviewed scoped imports, strengthened background-read and reload protection, then independently ran integrated gates. The owner authorized the five pinned runtime dependencies and all three preceding BW1 PRs. W1 itself is uncommitted/unmerged; no deployment occurred.

## Verification

Commands ran at the component root, Node24.18/npm11.16/JDK25. Environment names below select the installed tools, temporary browser-library overlay and CJK font configuration. Logs are local ignored evidence; portable counts/hashes are in `../evidence/w1-test-summary.json`.

- `JAVA_HOME="$JAVA25_HOME" PATH="$JAVA25_HOME/bin:$PATH" ./gradlew test --no-daemon --no-parallel --console=plain`: exit0,26s,5 executed tasks; XML226 tests,zero failures/errors/skips; `w1-java-test.log` — passed
- `npm run lint` and `npm run typecheck`: all workspaces exit0; `w1-lint.log`, `w1-typecheck.log` — passed
- `npm test`:300 tests, API30/auth43/fields49/mocks59/ui17/admin7/back86/front9; `w1-web-test.log` — passed
- `npm run build && npm run test:bundle`: three apps built and bundle gate passed; final post-CSS logs `w1-build-final.log`, `w1-bundle-final.log` — passed
- `LD_LIBRARY_PATH="$BROWSER_LIB_DIR" CI=true npm run e2e:mock`: final single run27/27 in45.0s,including10 W1 journeys,five axe serious/critical=0 checks,and shared Markdown computed-height regression; `w1-e2e-final.log` — passed
- `npm ci && npm ls react-hook-form zod react-markdown react-day-picker sonner && npm run build && npm run test:bundle`: exit0; clean lockfile install,all five versions exact,all three app builds/bundle repeat successful; `w1-npm-ci.log`, `w1-dependencies.log`, `w1-build-ci.log`, `w1-bundle-ci.log` — passed
- `FONTCONFIG_FILE="$BROWSER_FONTCONFIG" LD_LIBRARY_PATH="$BROWSER_LIB_DIR" node .team/evidence/w1-browser-capture.mjs`: four loaded index/details captures at1440x900 and375x812,zero console/page/request/HTTP errors and no document overflow; `w1-browser/ready/summary.json` — passed
- `codex-ui-evidence` browser runner with the same environment,detail URL,two viewports and installed Chromium: exit0,zero blocking/outside-viewport findings; `w1-browser/skill-final/summary.json` — passed
- Root visual inspection of final PNGs: readable Traditional Chinese,correct multiline Markdown height,clear status/actions,stacked mobile cards and intended inner table scrolling; no clipped form controls or document overflow — passed
- Protected190-file manifest and final362-source manifest:all hashes match; Front/Admin/backend/runtime OpenAPI/codegen unchanged. Prior93 PostgreSQL tests and merged PR#225 java-integration CI remain valid for this unchanged backend — passed
- `cmp docs/v2/contracts/BW1c.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`, `git diff --check`,new-file whitespace checks,changed-document relative links and T501–504 task/report plus delivery validators: final documentation closure log — passed
- T504 independent source/evidence audit:source and final logs/manifests/browser artifacts inspected,no concrete defect; report `T-504.md` — passed

All TypeScript source passed the complete frontend chain. Subsequent root changes were one Back favicon markup line,shared CSS source scanning and one E2E assertion; affected builds/bundle/full E2E/browser captures were repeated. No backend source changed and no redundant PostgreSQL suite was run. No final required failure or skip remains.

Behavior mapping: C-04/status and C-05/typed values in resource-index/resource-details/fields tests; C-06 in P0 migrated entries tests,UI patterns and browser blockers; C-07/G-01 in nav/shell and notes-only browser journey; G-02 in URL/client/index/paging regressions; B-06/G-07 in validator/field-error/null tests; U-01/U-02/U-04 in copy/views/screens and toast checks. P0's18 migrated cases retain invalid integers,dirty lifecycle,conflict,original version after refetch,pending writes and returned baselines. W1 read-only media replaces the unreachable old editor-upload case; pickers remain W2.

Historical failures are retained,not hidden: workers recorded focused Red and dependency-integration failures; initial browser launch lacked indirect libraries and was repaired only in a temporary environment; an inherited title assertion changed album→Albums; evidence capture's initial multi-skeleton wait was fixed; browser inspection found favicon404 and missing CJK fonts; CSS regression then proved expected128px/received0px before adding the fields source directive. Final browser/build/E2E gates resolve these findings. Existing small-touch-target findings remain advisory; thresholds were not weakened.

## Documentation

Updated W1 section0/current acceptance,README,roadmap,personal readiness and PLAN. BW1a/BW1b/BW1c are VERIFIED via PR223/224/225; their old local-stage reports remain historical with `BW1-PUBLICATION.md` as the publication receipt. Original integration tree and immutable BW1a412/BW1b449/BW1c468-file snapshots remain intact. W1's new isolated integration tree prevents replacing that prior work.

Pinned additions:react-hook-form7.88.0,zod4.6.5,react-markdown10.1.0,react-day-picker9.14.0,sonner2.0.8. React Query is declared in fields at its existing5.103.2 version. No pre-existing external dependency version changed. Copied shadcn component code retains its MIT notice in `packages/ui/LICENSE.shadcn.md`.

## Risks and Follow-ups

W1 is not merged or deployed and does not establish production readiness. W2 media/relation pickers and other roadmap waves remain. Existing operational/backup/seed/visibility/media-index upgrade work and BW1b migration/query concurrency limits remain as previously documented. Real-API browser E2E is outside this mock-browser gate.

Custom views preserve existing two-write non-atomic reorder and UTC schedule semantics for W2. Arbitrary field keys containing dots or the form-reserved prefix remain the documented W1-FM12/01Q-12 limitation pending later schema work. Browser small-target advisories remain for frontend hardening. Existing dev-transitive brace-expansion high advisory,Gradle10 deprecation and large Vite chunk notice remain visible; no unapproved package upgrade or weakened check was used.
