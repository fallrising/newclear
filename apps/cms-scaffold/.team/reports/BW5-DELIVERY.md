STATUS: DONE

## Summary

BW5 implements BQ-06/07/08/10/11 on the accepted BW4 application. All seven principal-by-id operations return 404 PRINCIPAL_NOT_FOUND after authorization. Six media wire codes are uppercase and existing W2 picker messages, MSW handlers and generated types are synchronized. Admin content-type creation reports ordered field errors before writing; principal profiles and role permissions validate database limits, using Unicode code points. Invalid changes leave existing grants, sessions and audit data intact.

Public ref filters now follow published payload index rows while work filters retain work relations. V10 backfills existing indexes, including enabled ref/principal-ref fields without an explicit indexed flag. Public/member pages batch media and variants, attachments, attached entries and required-reference targets. Existing published-payload value matching, enabled-type/media-field/publicBytes and visibility checks remain enforced; working-only replacement media stays null until published. No existing transaction, last-admin, ownership, version or audit protection was replaced.

Root owns BQ-10, contracts and frontend integration. T-911 and T-912 used isolated bounded Codex worktrees; T-913 independently reviews the integrated source/evidence. Full local gates and independent acceptance pass. Remote publication requires successful CI and an exact-head merge.

## Verification

- Supplied JDK25 through JAVA_HOME/PATH: `./gradlew test integrationTest bootJar --rerun-tasks --no-daemon --no-parallel --console=plain`; exit0, BUILD SUCCESSFUL in5m34s, all9tasks executed. JUnit339 Java/API and140 PostgreSQL, zero failures/errors/skips; `bw5-backend.log` and current XML — passed
- `npm ci`, `npm run gen -w @cms/api`, `npm run lint && npm run typecheck && npm test && npm run build && npm run test:bundle`; exit0,395 frontend tests. Logs `bw5-{npm-ci,codegen,lint,typecheck,web-test,build,bundle}.log` — passed
- After a documentation-only FieldError description correction, codegen repeated and `npm test -w @cms/api` passed32 cases; source/contract manifest binds the final generated file — passed
- `CI=true npm run e2e:mock` with the existing Chromium/font/library environment, serially after Docker gates; exit0,39passed in1.2m, zero exclusions; `bw5-e2e.log` — passed
- `python3 .team/evidence/bw5-perf-run.py` with JDK25: three forced original10,000-entry PostgreSQL tests passed. Work/public/update p95:109/89/35ms,74/74/20ms,79/75/18ms; original150/100/80ms thresholds unchanged. Linux4cores/PostgreSQL16.15/JDK25.0.4.1. Direct queryEntries remains2SQL; existing ListQueryCountTests also pass — passed
- T-911 focused15 cases and T-912 focused37 Java/API plus11 PostgreSQL cases pass; root's imported8+12 files match frozen worker hashes. Exact commands and failure history are in scoped reports — passed
- Root BQ-10 focused `./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*PublicRefFilterApiTests' --tests '*ErrorCodeContractTests' integrationTest --tests '*JdbcContentStoreContractTests' --tests '*EntryIndexBackfillTests' --no-daemon --no-parallel --console=plain`;55 Java/API and55 PostgreSQL cases pass — passed
- Real PostgreSQL media count tests: known media+variants2queries for1and3IDs, attachments1query, empty0SQL, all-unknown media1query. Public and member1vs3 pages retain identical store-call sequences and actual thumbnail output;21 unsafe-media scenarios remain denied — passed
- `cmp docs/v2/contracts/BW5.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`; byte equality.52 existing paths and all schema names retained; only ErrorCode/ErrorEnvelope/FieldError/FieldErrorCode schemas changed. Enum consistency and generated freshness pass — passed
- Final431 source hashes match gate;396 prior source/dependency files protected. Eight immutable snapshots412/449/468/566/602/710/732/762 and original468 files intact; dependencies, locks, old migrations and workflows unchanged — passed
- Independent T-913 final source/evidence review DONE, no concrete defect; `python3 "$BW5_DOC_CHECK"` validates all task/report contracts, changed/new links, whitespace, source/protected hashes and immutable snapshots — passed

[Verification summary](../evidence/bw5-verification-summary.json), [source hashes](../evidence/bw5-final-source-manifest.json), [protected files](../evidence/bw5-protected-manifest.json), [performance](../evidence/bw5-performance.json), [preservation](../evidence/bw5-preservation.json) and [log hashes](../evidence/bw5-log-manifest.json) bind the evidence. Full logs and sanitized Red artifacts remain local.

## Documentation

Read the complete historical BW5 specification before implementation. Section0 and PLAN record current compatibility/security requirements and bounded paths; earlier whole-file replacements, fixed test counts and frontend CI exceptions do not apply. Runtime OpenAPI evolves incrementally and the existing frontend follows the new media codes in this wave. BW4 publication is closed with its CI/merge receipt. Performance rows are appended without changing earlier observations.

Historical Red evidence is retained: BQ-10 two Java/API and two PostgreSQL failures showed work refs leaking into public filtering and missing V10 rows; the picker test showed uppercase errors losing their specific message; T-911 initial4 cases showed old principal/media/admin behavior; T-912 count Red showed content calls growing10→24. Resolved intermediate failures include a test-only field accessor typo, an unquoted colon in the root YAML description (codegen and worker startup), an editor fixture that actually held manage_media corrected to an unprivileged member, and documentation trailing whitespace. No assertion, authorization, count or performance threshold was relaxed. Final integrated gates pass without exclusions.

## Risks and Follow-ups

Concurrent duplicate-email requests retain the specification's accepted unique-constraint race limitation. V10 rebuilds derived indexes; deployment backup/maintenance planning remains an operational task. Performance figures measure content-store operations, not full HTTP or media-page latency. No dependency, existing migration, workflow, other component or UI layout changed. No deployment occurred; operational backup/restore and real API browser acceptance are separate. In-memory mode retains its existing lack of database rollback. Earlier dirty worktrees and snapshots remain preserved.

Next recommended feature wave is W3 Front public pages (albums/photos, clinic and projects), starting with a complete specification/current-source reconciliation. Do not use historical whole-file replacements to discard the accepted W2/BW5 behavior.
