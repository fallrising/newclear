STATUS: DONE

## Summary

P0 PR [#212](https://github.com/fallrising/newclear/pull/212) was merged at `10a4c8d1999cda38d069c1a36810b4dab7485bd5` after java, java-integration, web and trailer CI passed. Then BW1a was documented, implemented and locally verified on branch `feat/cms-bw1a-metadata-capabilities`. This report accepts the local BW1a implementation; it does not claim a BW1a merge, deployment or completed v2 roadmap.

BW1a adds V5 type settings and field metadata, configured title/search/visibility/order, localized seed metadata, surface-specific capabilities and request-local grant/role caching. Both stores preserve metadata and all P0 transaction/CAS/media guarantees. The actual login/me path shares the role cache, avoiding an extra role read. Frontend generated types, typed fixtures, mock behavior and login session mapping now match the contract without adding W1 navigation/editor features.

## Verification

Commands ran from apps/cms-scaffold with JDK25 selected. Local machine paths are represented by environment variable names below; logs are local ignored artifacts under .team/evidence.

- `JAVA_HOME=$JAVA25_HOME PATH=$JAVA25_HOME/bin:$PATH ./gradlew test integrationTest bootJar --no-daemon --no-parallel --no-build-cache --rerun-tasks --console=plain`: exit0, BUILD SUCCESSFUL in 1m3s, 9 executed tasks; XML totals 151 unit/API and 65 PostgreSQL integration tests, zero failures/errors/skips. Evidence: ../evidence/bw1a-backend-final.log and services/cms-api/build/test-results/{test,integrationTest}. — passed
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:bundle`: chained with &&, exit0. 140 tests: api13, auth39, fields7, mocks27, ui9, admin7, back29, front9. Evidence: ../evidence/bw1a-{lint,typecheck,web-test,build,bundle}.log. — passed
- `LD_LIBRARY_PATH=$BROWSER_LIB_DIR CI=true npm run e2e:mock`: exit0, 17 passed in 23.8s. Existing local browser libraries, no installation or added dependencies. Evidence: ../evidence/bw1a-e2e.log. — passed
- `cmp docs/v2/contracts/BW1a.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`: exit0, no output. Generated schema freshness also passed in api tests. — passed
- `git diff --check`: exit0. Reviewed all implementation diffs, including incremental EntryService/MediaService changes, query parameter binding, metadata-preserving updates and auth cache scope. Dependency manifests/lockfiles and V1–V4 have no changes. — passed
- Hardcoded-name scan with `rg -n '"sortOrder"|get\("visibility"\)|"title"\)' services/cms-api/src/main/java/com/fallrising/cms -g '*.java' -g '!**/*Seed.java'`: only JdbcMediaStore's database title remains. — passed
- Team task/report validator: T-201, T-202 and T-203 task and report files plus this delivery report pass the installed teamctl validator. — passed

## Documentation

BW1a §0 supersedes historical BW0-only patch and web-failure exceptions. It was written before implementation, then amended before the AuthService cache fix. README, roadmap, P0 merge state and personal readiness document reflect actual local vs merged status. Resolved IDs: B-03/B-04/B-05/B-12 and G-01/G-05/G-06/G-11. Full model dispositions and portable receipts are in T-203.

Red→Green evidence: T201 store signature/metadata compile regressions, three seed failures and visibility/order compile regressions; T202 seven missing-capability HTTP failures plus two actual toMe/capability role-read regressions (2/5 reads instead of 1/2). Frontend first showed four missing metadata/capability regressions, then one lost-login-capability and two configured-entry behavior regressions. Final checks above passed without removing assertions.

A fixture integration attempt initially copied later-wave publishRequestedAt/version data and failed existing mock assertions/type checks; fixed by projecting only BW1a title metadata over existing entry fixtures. Historical raw failure logs remain local; no tests or type validation were weakened.

## Risks and Follow-ups

BW1a remote CI and merge were not performed; this phase is LOCAL_VERIFIED. Real-API browser E2E, production deployment, admin bootstrap/seed lifecycle and backup/restore drills remain unrun future work; they are not claimed by the local gate. P0's previous live CI is at https://github.com/fallrising/newclear/actions/runs/37129643725.

V5 only adds columns, but custom types previously relying on a literal payload visibility key must be audited before upgrade: visibility now follows visibilityField; null settings treat content as public subject to existing authorization/publication checks. Built-in demo types receive seed settings. Existing incomplete published-media attachment indexes are not globally repaired by P0/BW1a. There is still no admin UI/API to edit type/field metadata; full model governance is a later wave.

Existing dev-transitive brace-expansion advisory remains recorded by P0; no dependencies changed. Vite chunk-size and Gradle10 deprecation advisories remain, while current build/bundle gates pass. Request caches expire with the request, so no permission persistence across requests; within-request mutation/recheck is outside current flows.
