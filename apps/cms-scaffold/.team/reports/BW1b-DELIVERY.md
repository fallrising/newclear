STATUS: DONE

## Summary

BW1b is implemented locally on the preserved, previously verified BW1a snapshot. It adds work/public paging and totals, indexed search/sort/filter/ref queries, predicate authorization before counting/paging, atomic work/published indexes and V6/V7 migration/backfill. Existing Front/Back complete-list consumers use a defensive sequential helper until W1 introduces explicit paging controls. No dependencies were added.

Documentation §0 was updated before implementation and before review-driven corrections. P0 transactions/CAS/purge/revisions/media isolation and BW1a request caches remain intact. Compatibility corrections preserve previously accepted fractional values using NUMERIC/BigDecimal, handle maximum-page offsets using long, reject public sort alias bypasses and repeated unknown parameters, and prevent absent indexes from exposing private or invalid-parent entries.

## Verification

All commands ran in the component root. `JAVA25_HOME` selects the installed JDK 25; `BROWSER_LIB_DIR` selects the existing Chromium library directory. Final integrated execution predates this documentation-only closure; existing output and XML were inspected again, without rerunning unchanged suites.

- `JAVA_HOME="$JAVA25_HOME" PATH="$JAVA25_HOME/bin:$PATH" ./gradlew test integrationTest bootJar --no-daemon --no-parallel --no-build-cache --rerun-tasks --console=plain` on final main: BUILD SUCCESSFUL, 202 unit/API +91 PostgreSQL, zero failures/errors/skips; `.team/evidence/bw1b-backend-final.log` and final JUnit XML (including timestamp fixture) — passed
- `services/cms-api/build/test-results/integrationTest/TEST-com.fallrising.cms.contract.ListQueryPerformanceTests.xml`: 10,000 entries, p95 work 85ms / public 77ms / patch 18ms; original 150/100/80ms limits and exactly two content SQL statements retained — passed
- `npm run lint` and `npm run typecheck`: integrated chained run exit 0; `../evidence/bw1b-lint.log`, `../evidence/bw1b-typecheck.log` — passed
- `npm test`: 166 tests (api25/auth39/fields7/mocks41/ui9/admin7/back29/front9), including generated schema freshness; `../evidence/bw1b-web-test.log` — passed
- `npm run build` and `npm run test:bundle`: all three apps built, bundle gate passed; `../evidence/bw1b-build.log`, `../evidence/bw1b-bundle.log` — passed
- `LD_LIBRARY_PATH="$BROWSER_LIB_DIR" CI=true npm run e2e:mock`: 17 passed in 21.8s; `../evidence/bw1b-e2e.log` — passed
- `cmp docs/v2/contracts/BW1b.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`: exit 0, exact equality reconfirmed during closure — passed
- `git diff --check`: exit 0; original scope/source review and BW1a snapshot hash checks confirmed protected dependency manifests/locks and V1–V5 unchanged; refreshed delta manifest excludes itself — passed
- `teamctl.py validate-task` for T-301 through T-304 and `validate-report` for T-301 through T-304 and BW1b-DELIVERY: final contract validation recorded in `../evidence/bw1b-doc-validation.log` — passed

Worker Red→Green chronology and resolved intermediate failures remain in T-301/T-302/T-303; independent closure audit is T-304. External review disposition is `../evidence/bw1b-review-triage.md`. No required final gate remains failed or skipped.

## Documentation

The orchestrator maintained BW1b §0 and .team/PLAN.md; task files define isolated scopes and budgets. Main source changes are compared against a SHA256 snapshot of BW1a, because git HEAD remains merged P0 and a plain git diff includes both waves. V1–V5 and dependency manifests/lockfiles are unchanged by BW1b. Runtime OpenAPI and generated types use the BW1b contract.

Codex coordinated three isolated workers (two high-reasoning backend, one medium frontend) and reviewed the actual changes. Cursor composer-2.5 reviewed only anonymously fetched public specification excerpts; its exit0/23.2s receipt and source provenance are recorded. Grok and OpenCode had already been exercised successfully in BW1a; this wave reused the CLI guidance without repeating every provider. No unsupported provider-cost estimate is claimed.

## Risks and Follow-ups

Local delivery only: BW1a/BW1b are uncommitted and unmerged. No remote CI, deployment or production readiness claim. Existing P0 PR #212 remains the last merged delivery. Separate wave review must preserve the BW1a→BW1b order.

V6 changes the numeric index column to NUMERIC and V7 rebuilds both index scopes. This may lock tables and uses memory proportional to one type's entries during backfill; production upgrades require backup/restore validation and maintenance planning. Existing custom visibilityField settings must still be audited as documented in BW1a. The application payload number parser is unchanged; this wave avoids index truncation, not arbitrary-precision guarantees for every JSON client.

The complete-list helper intentionally fails on inconsistent totals/duplicate IDs/missing progress across requests; retry is preferable to silently returning partial data. Count/page are separate SQL statements, so concurrent updates can cause such inconsistency. Explicit UI paging remains W1 work.

Known BW1b scope limits remain: public ref filters use work-copy refs (BQ-10); media expansion may perform per-item media reads (BQ-11), separate from the constant content-query bound. Predicate startup validation can reject existing noncompilable grants and requires pre-upgrade review. Bootstrap/seed lifecycle, published-media index repair and actual backup/restore/deployment drills remain production prerequisites. Real API browser E2E was not run as part of this wave; browser evidence is the mock suite.

Existing Vite chunk-size/Gradle10 deprecation advisories and the previously recorded dev-transitive dependency advisory remain; no dependency workaround or weakened threshold was introduced.
