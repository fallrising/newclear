STATUS: DONE

## Summary

BW3 implements G-08/B-11/BD-12: authenticated Front member list/get/create through the generic `/api/v1/me` endpoints. Reads use indexed working ownership; lists retain fixed draft/published states and validated query grammar. Responses expose only enabled public working fields, safe public media and a safely projected title. Create overwrites client ownership, rejects publicationState even when null, validates required/owned-reference fields and always creates a draft through the existing audited transaction. Missing/null/non-object HTTP payloads return400 before quota; valid payload validation failures count toward the rolling5-per60-second per-principal limit.

The appointment_request seed grants only member Front create. A PostgreSQL regression exposed JSONB formatting causing duplicate predicate grants on reseed; semantic JSON comparison corrects it without deleting grants or changing policy. Runtime OpenAPI and generated TypeScript are incremental; prior paths/components remain unchanged except the additive RATE_LIMITED code. No dependencies, migrations, existing stores or UI implementation changed.

T801/T802 used isolated bounded Codex workers, with T803 independent review. Root inspected actual files, preserved prior work/snapshots and ran integrated gates. Publication follows standing owner authorization after local acceptance and remote CI; no deployment.

## Verification

- `npm ci` and `npm run gen -w @cms/api`: clean install and contract generation succeeded; bw3-npm-ci.log / bw3-codegen.log — passed
- `npm run lint && npm run typecheck && npm test && npm run build && npm run test:bundle`: root full chain exit0;395 tests (32/43/61/92/18/7/133/9), all three applications built; bw3-{lint,typecheck,web-test,build,bundle}.log — passed
- `CI=true npm run e2e:mock` with existing Chromium/font/library environment: all39 tests passed in1.9m, no exclusions; bw3-e2e.log — passed
- Worker focused gates: T80121 API/projection, T8024 limiter and5 real PostgreSQL cases passed. Root full gates additionally validate final fixture corrections; worker report counts are not substitutes for root acceptance — passed
- Semantic comparison confirms all previous OpenAPI paths/components unchanged except additive RATE_LIMITED; runtime byte-equals BW3, freshness covered by API tests. Six immutable snapshots412/449/468/566/602/710 and original468-file integration tree preserved; bw3-preservation.log — passed

- With supplied JDK25 on JAVA_HOME/PATH, `./gradlew test integrationTest bootJar --rerun-tasks --no-daemon --no-parallel --console=plain`: root final command exit0, BUILD SUCCESSFUL5m8s, all9 tasks executed;279 Java/API and125 PostgreSQL tests, zero failures/errors/skips. Real10,000-entry store p95 work65ms/public74ms/patch19ms; bw3-backend.log and current JUnit XML — passed
- Final410 source hashes equal the gate manifest;396 protected source/dependency files equal W2. No existing test source changed, and the two new fixture corrections were covered by the final full gate — passed
- `python3 "$BW3_DOC_CHECK"`: task/report contracts, changed/new links, whitespace, source/snapshots and OpenAPI equality; bw3-final-doc-validation.log — passed
- Independent T803 final source/evidence review and root worker diff acceptance; no unresolved assigned defect — passed

[Verification summary](../evidence/bw3-verification-summary.json), [final source manifest](../evidence/bw3-final-source-manifest.json), [protected manifest](../evidence/bw3-protected-manifest.json) and [log manifest](../evidence/bw3-log-manifest.json) bind the result. Complete local logs retain exact commands/results; compact manifests bind accepted source and log bytes before publication.

## Documentation

BW3 section0 precedes implementation and records each accepted review correction before code. PLAN/task files bound inputs, scopes, checks and budgets; root owns integration. W2 publication receipt and status are also closed in this change. README/readiness/roadmap will reflect final acceptance before commit; remote merge receipt follows successful required CI.

Historical failures are retained in worker reports/logs: missing member endpoint Red, malformed body Red, fixture reference maintenance, disabled-type malformed input, PG record-accessor corrections and JSONB seed idempotence. Root's first full Java attempt ran279 tests with1failure: a new shared-store fixture used invalid visibility `private`, exposing a schema failure in unchanged TypeSchemaTests. Root replaced only the new fixtures with the valid nonpublic `back` value after documenting the finding; all assertions and the original contract remain. Failed backend log and first source manifest are preserved. An initial ad-hoc preservation assertion assumed the new enum value would be appended; the corrected check verifies exactly one addition and unchanged ordering of all prior values. The first document check also ran before T803 had finalized its report and failed the report format gate; the stable DONE report and complete document check subsequently passed. No product contract or regression was weakened.

## Risks and Follow-ups

Limiter quotas remain in memory per application instance and idle principal queues are retained; no distributed quota is claimed. Existing duplicate seed grants are not deleted. Member UI remains W3b; clinic approval workflow remains BW6. BW4 is the next proposed backend milestone: application/DataSource wiring, real application rollback, audit retention, security matrix and performance evidence.

Inherited dev-transitive brace-expansion advisory and existing Gradle/build notices remain unchanged. Mock browser checks do not establish real-API operation; no new UI requires new screenshots. BW4 and backup/restore/seed/media-index operational acceptance remain open. This milestone does not establish production readiness and includes no release or deployment.
