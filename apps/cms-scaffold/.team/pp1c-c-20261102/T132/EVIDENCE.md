# T132 focused evidence

Started 2026-11-02T14:25Z; frozen 2026-11-02 approximately14:42Z. Root supplied merged/readback PR989 prerequisite before implementation. All work remains uncommitted in isolated revoke worktree. No outside source scope changed.

- C13a183lines: named actual PostgreSQL Red stub fails SESSION_REVOKE_FAILED after compilation, then6/6PG Green. Logs/XML and core snapshot preserved. First sandbox shared Gradle lock permission failure is environmental, not Red; native authorized cache/Testcontainers invocation used.
- C13b232lines: named Ready-before-EOF Red expected connector count1 but observed0; then6revoker+16inventory unit pass. Includes20visibility-only lines in RecoveryInventoryMain.
- C14a70lines: named exact revoke dispatch Red expected0 observed2; then39unit(14app,9revoker,16inventory) pass. Fixed dispatch and extra malformed/request/backend replacement faults.
- C14b155lines test-only: actual runner5PGcases plus6corePG cases pass. The first fixture used Testcontainers query-bearing getJdbcUrl and failed INPUT_INVALID before Ready; all5failures/log/XML/initialtest preserved. Correction constructs fixed no-query host:port/cms URL and reports early runner failure immediately. Production validation unchanged. This is verification-only coverage around existing Green implementation, not a fabricated new product Red.

Commands all use JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout900 ./gradlew and --no-daemon --no-parallel. Exact focused selectors:
C13a integrationTest --tests '*RestoreSessionRevokerIntegrationTests.PP1c_revokeAllAndExactlyOneAuditLeavesOtherTablesUnchanged' (Red), then '*RestoreSessionRevokerIntegrationTests' (Green).
C13b test --tests '*RestoreSessionRevokerTests.PP1c_revokeReadyThenEOFRejectsBeforeMutation' (Red), then '*RestoreSessionRevokerTests' and '*RecoveryInventoryMainTests' (Green).
C14a test --tests '*CmsApiApplicationTests.pp1cExactRevokeDispatchNeverStartsBootOrOtherRoutes' (Red), then '*CmsApiApplicationTests', '*RestoreSessionRevokerTests', '*RecoveryInventoryMainTests' (Green).
C14b integrationTest --tests '*RestoreSessionRevokerMainIntegrationTests' --tests '*RestoreSessionRevokerIntegrationTests'. Corrected fixture Green log20seconds;11tests0fail/errors/skips.
All Gradle task names are :services:cms-api:test or :services:cms-api:integrationTest. Native focused runs use existing shared caches and only synthetic PG16 Testcontainers. No full suite, APIimage rebuild, real restore/root runtime, network fetch, external mutations, dependencies, Git mutations or cleanup.

Core invokes existing JdbcIdentityStore.insertAudit on SingleConnectionDataSource(connection,true), no new connection. One timestamp/UUID, UPDATE only null revoked_at, exactly specified AUTH/detail/receipt. Core rollback only before commit attempt. Runner same connector and same live PID/epoch before write and before commit; rollback readonly preparation, setReadOnly(false), exact Permit+EOF before mutation. Connection closes before receipt; lost commit/receipt produces fixed error without SQL retry/rollback claim. Environment credential values ignored; private file content only to JDBC properties.

Final7-file hashes identify the frozen source. Checkpoint snapshots include all changed code/tests and remain below400. Prior budgets not reset; this new75minute C assignment used approximately18active minutes through source freeze (exact active/wait/provider/token/cost unknown). Independent review, root fullgates/helper/image/actual C runtime and publication remain pending.
