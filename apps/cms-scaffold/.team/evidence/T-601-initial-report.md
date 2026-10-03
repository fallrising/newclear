STATUS: PARTIAL

## Summary

Implemented the bounded BW2 identity/audit slice incrementally. Added paged audit query stores and audit endpoints, literal SQL LIKE prefix escaping, deterministic timestamp/id ordering, long offsets, validation before unknown-actor empty pages, deleted/anonymous actor projection, and assignable principals. Existing identity event writers remain intact; only new role permission writes use `role.permissions_update`.

Added `AuditLog.record(actor, surface, category, action, targetType, targetId, outcome, detail)` and `TransactionRunner.inTransaction`, `run`, `withoutDatabase`, and `independently`. Denied governance audits run in REQUIRES_NEW and survive an ambient state transaction rollback. Type create/enable/disable, navigation publish, media soft deletion, and role permission changes run with their audit in one shared DataSource transaction. Media soft deletion preserves physical blobs.

Worker-owned changed paths: identity/domain/{AuditPage,AuditQuery}.java; identity/service/{AuditLog,AuditSearch,AuthorizationService,PrincipalAdminService}.java; identity/store/{IdentityStore,InMemoryIdentityStore,JdbcIdentityStore}.java; identity/web/{AuditController,PrincipalController}.java; identity/IdentityException.java; platform/TransactionRunner.java; api/error/ErrorCode.java; content/web/AdminContentController.java; content/service/NavigationService.java; media/service/MediaService.java; tests AuditTrailApiTests, AuditQueryApiTests, AssignablePrincipalsApiTests, contract/IdentityStoreContract, support/ApiFixture; integrationTest/contract/AuditAtomicWriteTests.java. Paths relative to services/cms-api/src/ where applicable. Other working-tree changes were provided by root/T602 and were not edited by this worker.

The focused API Red run demonstrated the intended gaps: all five initial audit-query/assignable tests failed against old/missing endpoints. PostgreSQL fault injection writes a real audit row and then throws; assertions require the database state and row to roll back together. The denied-governance test requires its row to survive rollback of an unrelated type mutation.

## Verification

Every Gradle command used `JAVA_HOME="$JAVA25_HOME" PATH="$JAVA25_HOME/bin:$PATH"`.

- `./gradlew :services:cms-api:test --tests '*AuditQueryApiTests' --tests '*AssignablePrincipalsApiTests' --no-daemon --no-parallel --console=plain` (`/tmp/T-601-red.log`) — failed: expected Red, 5 tests/5 failures against old audit responses/missing endpoint.
- `./gradlew :services:cms-api:test --tests '*AssignablePrincipalsApiTests' --tests '*IdentityHardeningTests' --no-daemon --no-parallel --console=plain` (`/tmp/T-601-green1.log`) — failed: old out-of-scope TypeSchemaTests controller constructor. Root updated that test callsite; all original assertions retained.
- `./gradlew :services:cms-api:test --tests '*AssignablePrincipalsApiTests' --tests '*IdentityHardeningTests' --tests '*InMemoryIdentityStoreContractTests' --tests '*AuditQueryApiTests.B07_invalidParameters*' --tests '*AuditQueryApiTests.B07_unknownActor*' --tests '*AuditQueryApiTests.B07_deletedActor*' :services:cms-api:integrationTest --tests '*AuditAtomicWriteTests' --tests '*JdbcIdentityStoreContractTests' --no-daemon --no-parallel --console=plain` (`/tmp/T-601-green2.log`) — failed: unit task passed; integration 20 tests/3 fixture failures (timestamp nanos versus persisted micros; null identity transaction template). Fixtures corrected deterministically.
- `./gradlew :services:cms-api:test --tests '*AuditTrailApiTests' --tests '*AuditQueryApiTests' --tests '*AssignablePrincipalsApiTests' --tests '*IdentityHardeningTests' --tests '*InMemoryIdentityStoreContractTests' :services:cms-api:integrationTest --tests '*AuditAtomicWriteTests' --tests '*JdbcIdentityStoreContractTests' --no-daemon --no-parallel --console=plain` (`/tmp/T-601-green3.log`) — failed: unit slice 31/31 passed, zero skips; integration slice 18/20 passed, zero skips. Remaining failures: shared T602 JdbcContentStore navigation UPDATE has unmatched parameter 8; role fixture omitted usable admin. Role fixture subsequently corrected by inserting an actual active admin/role/manage_principals grant; last-admin guard remains intact.
- Final corrected role fixture and shared navigation fix integration rerun — skipped: bounded three rework loops reached; root owns combined Java/PostgreSQL gate after import. Neither assertion was weakened.
- `git diff --check` — passed, exit 0 after final fixture correction.
- Assigned diff review/evidence gate — passed: edits confined to the worker's paths; all non-entry writers use shared transaction boundaries, query SQL is parameterized and escaped, denied auditing is independent, legacy identity events and soft-delete blob semantics preserved. Root/T602-provided supporting changes were read-only.

## Documentation

No specification or PLAN edits by this worker. Root owns BW2 section0 clarification, runtime OpenAPI/codegen integration, complete gate evidence, and final acceptance. Shared interfaces were published to root early and transferred to T602.

## Risks and Follow-ups

Root must verify the corrected role fixture and repaired shared navigation SQL using the final combined integration gate before accepting this result. Current PARTIAL status deliberately retains prior failed and unrun evidence.

The legacy four-argument MediaService constructor remains for existing manually assembled test services and does not supply an audit writer or JDBC transaction runner. Production Spring wiring uses the full @Autowired constructor with both dependencies; the real PostgreSQL audit tests also use that full constructor. PrincipalAdminService and AuthorizationService preserve their old test constructors. In-memory execution does not claim cross-store rollback.

No dependencies, commits, pushes, PRs, ledger changes, migrations, or external mutations were made by this worker. V8 and content/OpenAPI/supporting test changes visible in this tree came from root/T602.
