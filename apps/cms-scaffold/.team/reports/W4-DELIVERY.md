STATUS: PARTIAL

## Summary

W4 delivers the shared Admin governance surface of the reusable CMS kernel. Album, clinic and projects are demonstration packs; this milestone is not a clinic-specific product. Baseline is W3b merge `a0de08a41eaf3fdc7c56e4ae86b819b705b0ce87`.

Implemented overview, read-only type/schema information and enable/disable, fixed-role permission matrices, account creation/profile/status/password/role assignment, read-only audit filtering and detail, library quota display, retention settings, and emergency entry inspection/actions/principal links. No custom-role CRUD, schema designer, backend confirmations or deployment.

Local status: **LOCAL_VERIFIED**, pending required remote CI and merge.

Root reviewed bounded GPT-6.1 Sol API/mock and Admin workers, with GPT-6 Luna independent inventory/review. T-941/T-942 original manifests represent frozen worker baselines; root's final source manifest supersedes the generated fixture and three subsequently corrected UI files.

## Verification

- Root Admin integrated `npm test -w @cms/web-admin -- --maxWorkers=2`: 68 passed, followed by typecheck/lint exit 0 — passed
- Root Checkbox/Progress: intended Red 1 failure/18 prior passes, final UI 19 passes; typecheck/lint exit 0 — passed
- Six root governance regressions: malformed UUID, current linked account beyond first 50/search/disabled status, cached principal confirmation/password, cached entry purge and type confirmation. All six intended Red, then all six Green — passed
- Mock type uniqueness: intended Red for 13 rows/12 unique keys, then Green after removing only duplicate identical note entries — passed
- Java `./gradlew test --no-daemon --console=plain`: BUILD SUCCESSFUL; XML 339, no failures/errors/skips; test FROM-CACHE, unchanged backend — passed
- `npm ci`: locked install completed; existing high-severity transitive advisory retained, no upgrades — passed
- `npm run gen -w @cms/api`: no generated schema change; `node packages/mocks/scripts/gen-fixtures.mjs --check`: fresh — passed
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:bundle`: all exit 0. Frontend 624 = API 43, auth 43, fields 61, mocks 125, UI 19, Admin 68, Back 133, Front 132; `w4-final-gates.json` — passed
- `CI=true npm run e2e:mock` with configured Chromium library/font environment: 68/68, 2.7 minutes, no retry or test exclusions; `w4-e2e.log` — passed
- `node .team/evidence/w4-browser.mjs`: 14 desktop/mobile visual smoke captures, zero browser errors/document overflow; root inspected eight views; `w4-browser/summary.json`, `w4-visual-review.json` — passed
- `python3 .team/evidence/w4-verify.py --baseline "$BASELINE_MANIFEST" --prior-snapshots "$PRIOR_SNAPSHOTS" --snapshots-root "$SNAPSHOT_ROOT" --original-root "$ORIGINAL_ROOT"`: 883 protected files, 10 prior snapshots, 468 original-work files unchanged; runtime equals BW5, four governance/member/two corrected type fixtures equal authoritative copies; other historic projections preserved — passed
- T-941/T-942 diffs, logs and freeze manifests reviewed; all original six Admin behavior tests mapped to replacements; `w4-test-migration.json` — passed
- T-943 independent source, contract, scope and evidence review: DONE; all findings resolved, report validator passed — passed
- Required remote CI/review, exact-head merge and remote verification (follows local acceptance under owner standing authorization) — skipped

## Documentation

W4 §0 was written before implementation to preserve current runtime codegen, member mock/API state, dynamic quota and required existing E2E. Root reviewed and documented three governance boundary corrections, resettable mock identity generation, exact runtime profile semantics, and a pre-existing identical duplicate note in two packaged fixtures. Other historical fixture projections remain unchanged.

The six original Admin tests were mapped to replacement shell/types/principal tests before their approved replacement; see w4-test-migration.json. The old metadata-only emergency prohibition was intentionally superseded by W4's approved inspector, while day-to-day fields/board/clinic source exclusions remain. New Appendix A's 25 E2E cases remain W5; no claim of that full accessibility/functional acceptance here.

W3b publication receipt and roadmap are synchronized. This is the local pre-publication checkpoint. Required remote CI and merge will be closed by the PR publication receipt; it does not imply the full v2 roadmap is finished.

## Risks and Follow-ups

W4 UI dangerous confirmations do not provide BW6 server confirmation/self-protection. Custom-role CRUD, schema editing, per-account storage controls and pending backend fields remain outside this milestone. W5 next owns frontend hardening and complete UI/real-API validation. Existing transitive dependency advisory and large-chunk warnings are retained without unsolicited upgrades. Current main chunks: Admin 566.95 kB (gzip 180.59), Back 564.75 kB (gzip 179.94), Front 572.17 kB (gzip 179.38); existing bundle guard passes, W5 owns the tighter performance budgets. No local PostgreSQL/performance rerun or real-API browser E2E was done: backend unchanged; remote integration CI remains required. No production-ready claim or deployment.

Final staged diff check found two new-file blank lines at EOF that the unstaged check did not inspect; both were removed with no semantic change. Final source hashes were refreshed and staged diff check rerun.
