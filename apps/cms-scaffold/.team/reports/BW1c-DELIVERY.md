STATUS: DONE

## Summary

BW1c is LOCAL_VERIFIED on the preserved, previously verified BW1b snapshot. Implemented all-field payload validation with ordered `error.fields`, mandatory PATCH version (missing/null428, stale409), null clearing, and public unreadable media null on list/id/slug reads. Generated client types require version and preserve field errors; existing forms and seeded MSW behavior remain compatible. No dependencies or migrations changed.

Documentation section0 preceded implementation. Three disjoint isolated workers (Codex gpt-6.1-sol high for validator/backend, medium for frontend) used bounded tasks and Red→Green; Codex gpt-6-luna independently reviewed backend and evidence. Root reviewed each delta and ran final integrated gates. No external CLI received unreleased source; no cost figure is inferred.

## Verification

Commands ran in the main component root. `JAVA25_HOME` selects installed JDK25 and `BROWSER_LIB_DIR` selects existing Chromium libraries. Logs are local `.team/evidence/` artifacts; summary/manifest files preserve counts and hashes.

- `JAVA_HOME="$JAVA25_HOME" PATH="$JAVA25_HOME/bin:$PATH" ./gradlew test integrationTest bootJar --no-daemon --no-parallel --no-build-cache --rerun-tasks --console=plain`: exit0, BUILD SUCCESSFUL in4m36s, 9 executed tasks; 226 unit/API +93 PostgreSQL, zero failures/errors/skips; `../evidence/bw1c-backend-final.log` and `bw1c-test-summary.json` — passed
- Current `ListQueryPerformanceTests` XML (2026-10-03T16:13:29.584Z): 10,000 entries, p95 work75/public77/patch22ms; unchanged150/100/80ms limits and two content SQL statements; store-only measurements — passed
- `npm run lint` and `npm run typecheck`: root chained execution exit0, all workspaces; `../evidence/bw1c-lint.log`, `bw1c-typecheck.log` — passed
- `npm test`:179 tests (api26/auth39/fields7/mocks53/ui9/admin7/back29/front9), including generated-schema freshness; `../evidence/bw1c-web-test.log` — passed
- `npm run build` and `npm run test:bundle`: all three apps built and bundle limits passed; `../evidence/bw1c-build.log`, `bw1c-bundle.log` — passed
- `LD_LIBRARY_PATH="$BROWSER_LIB_DIR" CI=true npm run e2e:mock`: exit0,17 passed in24.8s; `../evidence/bw1c-e2e.log` — passed
- `cmp docs/v2/contracts/BW1c.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`: exit0; backend scan `orElse(raw)` has no matches — passed
- Snapshot/source inspection:27 dependency/migration/store/index files unchanged versus BW1b; all304 final gate source hashes unchanged; original BW1a412-file snapshot intact — passed
- `git diff --check`, new-file whitespace checks, changed-document relative links and `teamctl.py validate-task/validate-report` T-401 through T-404 plus this delivery report: exit0; `../evidence/bw1c-doc-validation.log` — passed
- T-404 independent source/evidence review: no concrete backend defect; final XML timestamps/counts and all304 source hashes confirmed — passed

Required behavior mapping: T-401 has15 validator tests; T-402 adds7 MockMvc behavior tests,2 projection tests and2 PostgreSQL legacy regressions while preserving prior assertions. T-403 adds transport preservation and MSW boundary tests; prior29 Back tests retain P0 input/conflict/pending coverage. Expected Red failures, the revision-loop missing version, temporary fixture/method-name mistakes, and isolated node resolution correction remain in the task reports. All required final gates pass; no final required failure or skip remains.

## Documentation

Updated BW1c section0/current checklist, README, v2 roadmap and personal readiness notes; `.team/PLAN.md` maps task DoD to evidence. `../evidence/bw1c-delta-manifest.json` measures this wave against the immutable BW1b snapshot, separately from BW1b's frozen BW1a delta. Git HEAD remains merged P0: plain git diff includes all three local waves. BW1a and BW1b snapshots are preserved.

Three intentional contract changes: PATCH must include its current version; unreadable public media returns null instead of a raw reference; payload422 reports all fields and summary message. Rule tightening also rejects oversized/wrong-type text, invalid offset datetimes, fractional/out-of-long integers, non-string enums and noncanonical ref/principal UUIDs. Existing values are not rewritten or truncated; reads remain available, and invalid merged patch/publish/revert is rejected without altering dependent data. A clean already-published legacy entry keeps P0's no-op publish behavior.

## Risks and Follow-ups

BW1a/BW1b/BW1c are uncommitted and unmerged. P0 PR#212 is the last merged delivery. No push, merge, release or deployment occurred. This is local verification, not production readiness. W1 remains the next roadmap wave for the full editor/field-error UI and explicit paging controls.

Existing BW1a visibilityField upgrade audit, published-media attachment repair, bootstrap/seed lifecycle and backup/restore/deployment drills remain pending. BW1b V6 NUMERIC conversion/V7 rebuild maintenance risks remain; this wave preserves those files and never cleans up legacy values. Predicate upgrade audit, public WORK refs (BQ-10), per-media expansion (BQ-11), and concurrent allEntries inconsistency/retry limitations remain unchanged.

Browser evidence is17 MSW/mock tests; real-API browser E2E is outside the required gate. Seeded mocks use available API metadata and JavaScript numeric values; publicBytes is not exposed, and existing mock publish does not synchronize a new public snapshot lifecycle. Server API/PostgreSQL tests establish authoritative permission, validation and transaction behavior. Existing Vite chunk/Gradle10 deprecation/development-transitive advisory remain visible; no threshold or dependency workaround.
