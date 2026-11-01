STATUS: DONE

## Summary

BW2 is LOCAL_VERIFIED on merged W1 main48a303b. Delivered B-07/B-11(part), G-03/G-04/G-09/G-10: transactional audit writes and paged audit search/detail; publish requests; assignable principals; atomic batch PATCH; bounded authorization-aware ref summaries. OpenAPI and generated frontend types/mocks are synchronized. No W2/W4 UI or dependency changes.

P0 CAS/version/rollback protection, BW1 indexing/validation/public visibility and W1 editing remain intact. Independent review found existing identity account/auth writes outside the audit transaction; documented T604 fixes those writes while preserving event names, session revocation, password rules and last-admin guards. Denied governance/login events remain durable across ambient rollback. PostgreSQL tests cover actual state and audit rollback, dependent rows and a concurrent batch winner.

W1 was explicitly saved and merged through [PR229](https://github.com/fallrising/newclear/pull/229), all CI green; [receipt](W1-PUBLICATION.md). BW2 itself remains uncommitted/unmerged in a separate integration tree. No deployment or production-readiness claim.

## Verification

Commands ran from the component root with Node24.18/npm11.16/JDK25. Java commands select `JAVA_HOME="$JAVA25_HOME" PATH="$JAVA25_HOME/bin:$PATH"`. Portable counts, class inventory and log hashes: [summary](../evidence/bw2-test-summary.json). Logs are local ignored artifacts.

- `npm ci`: lockfile install exit0; no dependency/lock changes (`bw2-npm-ci.log`) — passed
- `npm run gen -w @cms/api`, `npm run gen -w @cms/mocks`; `npm run typecheck`: all workspaces exit0 after required nullable publish-request fields were added (`bw2-codegen.log`, `bw2-typecheck-fixtures.log`) — passed
- `npm run lint && npm test && npm run build && npm run test:bundle`: all gates exit0;300 tests(api30/auth43/fields49/mocks59/ui17/admin7/back86/front9),three apps built,bundle gate passed (`bw2-lint.log`,`bw2-web-test.log`,`bw2-build.log`,`bw2-bundle.log`) — passed
- `LD_LIBRARY_PATH="$BROWSER_LIB_DIR" CI=true npm run e2e:mock`:27/27 in54.8s,including existing W1 dirty/version and axe journeys (`bw2-e2e.log`) — passed
- `npm test -w @cms/api`: final contract-description/codegen alignment30/30; generated changes since frontend build are comments only (`bw2-api-final.log`) — passed
- `./gradlew test integrationTest --no-daemon --no-parallel --console=plain`: Java test task254/254,zero failures/errors/skips. Full PostgreSQL portion had108 unaffected cases passing and6 failures among the old identity10 fixture comparisons; the historical whole command exited1 and remains visible (`bw2-java-postgres-final.log`,`bw2-postgres-full-run.json`). Current acceptance uses the resolved per-class evidence below — passed
- `./gradlew integrationTest --tests '*IdentityAuditAtomicWriteTests' --rerun-tasks --no-daemon --no-parallel --console=plain`: final12/12 actual execution,27s,six tasks executed. Only this test file changed after the full run; production hashes are identical. Latest PostgreSQL inventory is120 unique cases,zero remaining failures/errors/skips (`bw2-identity-postgres-final.log`) — passed
- Full-run 10,000-entry benchmark: work/public/update p95=86/80/19ms,within unchanged150/100/80ms gates; SQL count assertions pass. This is store-level measurement,not HTTP end-to-end — passed
- `./gradlew :services:cms-api:bootJar --no-daemon --no-parallel --console=plain`: executable backend artifact built (`bw2-bootjar.log`) — passed
- `cmp docs/v2/contracts/BW2.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`:byte equality; API codegen freshness and API response/path contracts verified — passed
- 384-source manifest and171 protected Front/Admin/Back/fields/UI/auth/dependency/old-migration hashes match; original468-file integration tree and412/449/468/566-file snapshots intact — passed
- T601/T602/T604 scoped diff reviews plus T603 independent final audit; task/report validators,changed links and `git diff --check` — passed

PostgreSQL120 is explicitly a latest-per-class inventory:108 cases from the complete run plus12 corrected identity cases from the forced rerun. It is not a claim that the retained118-case command exited0. The first targeted invocation reused Gradle cache; that log is kept separately and was followed by actual forced execution. No unaffected large suite was repeated after a test-only correction.

Behavior coverage: AuditTrail/AuditQuery/IdentityStoreContract map B-07; AuditAtomicWriteTests and IdentityAuditAtomicWriteTests prove state/audit atomicity and denial durability. PublishRequestApiTests/ContentStoreContract cover G-03 versions,filters,permissions and lifecycle. AssignablePrincipalsApiTests cover G-04. BatchPatchApiTests and Bw2AtomicWriteTests cover G-09 validation,authorization,CAS and rollback. IncludeRefsApiTests/RefSummariesTests cover G-10 target predicates,restricted/missing shapes and one lookup for100 sources. Existing P0 and W1 regressions remain.

Historical Red/failures remain visible: missing endpoints/required WorkEntry fields; navigation SQL accidentally acquired entry-only columns and was corrected; invalid synthetic type key; timestamp precision in DB comparisons; clean published entries retaining a request; JDBC request idempotence nanoseconds; identity audit atomicity; Java record byte-array equality. The final test uses recursive comparison of every session field,without ignoring any field. No validation or threshold was weakened.

## Documentation

Incremental BW2 section0 preceded implementation and overrides obsolete wholesale replacements, old counts and permitted frontend failures. T601/T602 used separate Codex high worktrees; T603 used independent Codex Luna review; T604 was a separately bounded response to its finding. Root owns integration,manifest evidence and acceptance.

Updated README,roadmap,backend SDD,personal-use readiness,W1 publication status and PLAN. [T601 initial PARTIAL report](../evidence/T-601-initial-report.md) preserves the bounded worker handoff; root acceptance resolves it with observed integration evidence. No old migration,lockfile,seed secret or workflow changed.

## Risks and Follow-ups

BW2 is not published or deployed. W2 media/relation pickers and atomic custom-view reorder,W4 governance UI and later roadmap work remain. Existing BQ-10 public ref behavior,BQ-11 media expansion,arbitrary field-key limitations and operational/backup/seed/media-index migration requirements remain documented.

Real PostgreSQL tests assemble JDBC stores/services. BW4 still needs complete application startup/DataSource store-selection verification(BQ-13); these tests do not establish production startup/persistence readiness. In-memory stores do not promise cross-store rollback. Compatibility constructors remain for old manual tests; Spring and new JDBC atomicity tests use transaction-aware constructors.

Existing dev-transitive brace-expansion advisory,Gradle10 deprecation,Vite chunk notice and W1 browser small-target advisories remain. No real-API browser E2E or deployment/backup drill was represented as executed.
