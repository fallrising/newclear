STATUS: DONE

## Summary

BW4 implements BQ-03 audit retention and BQ-12/BQ-13 application database hardening. Admin/manage_settings GET/PATCH supports30/90/365days with90default, strict body/field validation, atomic settings/audit changes and metadata-preserving no-op. Purging starts after1hour and runs with24hour fixed delay; configurable durations and strict-before cutoff preserve boundary events. Shortening retention does not purge immediately.

The three application stores now resolve DataSource during bean construction and select JDBC when configured; unit configurations without a DataSource retain memory stores. Actual Boot/PostgreSQL tests inject real audit foreign-key violations for publish and settings updates and verify rollback. Two complete application contexts, closed and recreated on the same database, preserve content, sessions, settings, public projection, indexes, revisions and audit. V9 default/singleton/day constraints are checked against PostgreSQL. No existing migration, dependencies, SQL builder or UI implementation changed.

Root owns contracts/codegen/surface matrix and integration. T901/T902 used bounded isolated Codex worktrees; T903 independently reviews source/evidence. Earlier BW3 publication is closed as VERIFIED in this change. Complete local verification is recorded below; publication requires successful remote CI and exact-head merge.

## Verification

- `npm ci` and `npm run gen -w @cms/api`: exit0, current runtime contract generated; bw4-npm-ci.log / bw4-codegen.log — passed
- `npm run lint && npm run typecheck && npm test && npm run build && npm run test:bundle`: complete root chain exit0,395tests and all applications built; bw4-{lint,typecheck,web-test,build,bundle}.log — passed
- `./gradlew test --tests '*SurfaceMatrixTests' --no-daemon --no-parallel --console=plain`: exit0, all51 specified denial cells; bw4-matrix.log — passed
- Worker T90128 focused tests plus17 real PostgreSQL store contracts; T9026 application/PostgreSQL tests including actual restart and rollback; exact commands in scoped reports — passed
- Existing runtime paths/schemas remain equal to BW3 except the two explicitly approved FieldError description changes;238 frontend/contract source hashes remain stable after frontend gates — passed
- With supplied JDK25 on JAVA_HOME/PATH, `./gradlew test integrationTest bootJar --rerun-tasks --no-daemon --no-parallel --console=plain`: exit0 BUILD SUCCESSFUL5m26s, all9tasks executed;293 Java/API and133 PostgreSQL tests, zero failures/errors/skips; bw4-backend.log and current JUnit XML — passed
- `python3 .team/evidence/bw4-perf-run.py` with supplied JDK25: three forced original10,000-entry tests passed, work/public/update p95 74/71/18ms,70/75/17ms,74/77/19ms. Direct queryEntries asserts2SQL, full ListQueryCountTests2cases confirm constant content lookup shape (4SQL), thresholds unchanged — passed
- Final422 source hashes equal the gate manifest;399 prior source/dependency files protected. All7 immutable snapshots412/449/468/566/602/710/732 and original468 integration files intact — passed
- `CI=true npm run e2e:mock` with existing Chromium/font/library environment, after container jobs completed: exit0, all39passed1.2m, no exclusions or changed assertions; bw4-e2e.log. First38/1 attempt and trace remain retained — passed
- `python3 "$BW4_DOC_CHECK"`: task/report contracts, changed/new links, whitespace, source/protected/snapshot checks and runtime/BW4 equality; bw4-final-doc-validation.log — passed
- Independent T903 exact-root source/evidence review DONE; T901/T902 scopes accepted after root diff review, no unresolved actionable defect — passed

[Verification summary](../evidence/bw4-verification-summary.json), [source manifest](../evidence/bw4-final-source-manifest.json), [protected manifest](../evidence/bw4-protected-manifest.json), [performance results](../evidence/bw4-performance.json) and [log manifest](../evidence/bw4-log-manifest.json) bind the evidence. Full logs and raw browser failure artifacts remain local; compact reviewable evidence is committed.

## Documentation

Read the full BW4 specification and current source; overriding section0 and PLAN precede implementation. Runtime OpenAPI adds only audit settings and description clarifications, then synchronizes BW4 contract and generated TypeScript. Scope authorizes additional real settings rollback/durability/constraint tests over historical gaps. Valid JSON objects authorize before domain validation; existing Spring MVC binds malformed/non-object/missing bodies to400, documented before code.

Historical Red: missing retention domain/store methods, missing service, and all3 memory stores selected despite actual application DataSource. These failures are resolved by focused worker gates. First root mockE2E run38/39: first page had12 module requests fail with ERR_NETWORK_CHANGED while parallel container tests were active. Raw trace/screenshot and bw4-e2e-first.log are retained; the serial rerun passed all39 unchanged cases after container jobs. No assertion, timeout, count or performance threshold is relaxed.

## Risks and Follow-ups

This is application-level Testcontainers durability evidence, not an operational backup/restore or deployment acceptance. No production deployment occurred. In-memory mode does not gain database rollback. Audit cleanup intentionally deletes only expired events, and setting a shorter duration waits for the next scheduled run. No immediate purge API is added. Multi-instance cleanup remains idempotent SQL deletion without a distributed coordinator.

Inherited dev dependency advisory and Gradle/build notices remain visible. Member UI, other Admin settings and later BW5 open-question work remain outside BW4. Preserve every previous dirty worker and immutable snapshot.
