# T128 actual PostgreSQL runner seam

Task scope: root explicitly authorized this new ops integration-test path before writing. Only RecoveryInventoryMain.java and RecoveryInventoryMainIntegrationTests.java changed. Read task, component instructions, current runner/unit tests, RecoveryInventoryIntegrationTests/PostgresFixture pattern, approved BackendV1/annex, root inet-text-probe and capture attempt2 evidence. Prior T126 files/hashes remain frozen.

## Root cause and minimal fix

PostgreSQL inet::text represents a host address with its prefix. The production Ready query used client_addr::text while the independent Node observer uses host(client_addr). The named actual PG16 runner test reproduced `172.17.0.1/32` versus `172.17.0.1` before any production change. The sole production edit replaces that expression with host(client_addr); no changed schema, public API, JDBC connection, transaction or cleanup behavior.

## Behavioral Red

Command:

```
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900 ./gradlew :services:cms-api:integrationTest --tests com.fallrising.cms.ops.RecoveryInventoryMainIntegrationTests --offline --console=plain
```

`red-native.log` and `red-results.xml`: one actual PG16 test failed at the intended observer comparison. Exact assertion: `Ready must match the independent host(client_addr) observer ==> expected: <172.17.0.1> but was: <172.17.0.1/32>`. Build17s. No preceding scaffold/fixture/compile failure. Red cleanup closes only its own test pipes/Testcontainers fixture.

## Green

Command:

```
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900 ./gradlew :services:cms-api:test --tests com.fallrising.cms.ops.RecoveryInventoryMainTests :services:cms-api:integrationTest --tests com.fallrising.cms.ops.RecoveryInventoryMainIntegrationTests --offline --console=plain
```

`green-native.log`: BUILD SUCCESSFUL in8s, both scoped test tasks executed (not test-result cache). XML evidence: existing runner units16/16,1.259s; actual PG16 integration1/1,3.503s; zero skips/errors/failures. An early progress message estimated18 existing units; observed XML count16 is authoritative.

The test starts an isolated existing postgres:16-alpine Testcontainers fixture with cms/cms_local and synthetic secret, applies existing Flyway migrations, and seeds a synthetic private row. It invokes the package-private production run seam with DriverManager, owned temporary0600 request/secret and0700 output, real pipes, and the actual RecoveryInventory inspector. Before sending Permit, an independent connection reads pg_stat_activity by PID and compares full PID/epoch/db/role/host-IP/applicationName to Ready; also proves no output artifact yet. It sends a canonical request/backend-hash-bound Permit, then verifies actual20-table inventory, artifact hash/db hash and0600 mode, same read-only repeatable-read non-autocommit connection, completion0, closed connection and absent backend. Secret/raw row/JDBC URL do not appear in Ready or Result; the raw row is present in the private artifact. Existing unit tests preserve rollback/close/error-redaction coverage.

## Checkpoint and limits

`checkpoint.json` plus before/after/diff evidence: 164 handwritten added+removed lines including tests (production2, newtest162), below400. `final-source-hashes.json` binds the two exact source files. Explicit whitespace scan includes the new test; git diff --check passed. Task/report validators recorded in validation.log.

Measured start12:49:43Z, freeze12:53:25Z,222 wall seconds; approximately4active minutes before report work within the new25minute task budget. Previous T123/T126 budgets were not reset. Disk29GiB free before tests. Testcontainers was the explicitly authorized test-only exception to no runtime; no old resources, Git mutation, network dependency download, delegation, new dependency, public API or formal contract changes. Root owns full Java/PG gates, new reviewed API image, fresh runtime capture and independent acceptance/publication. This test is not complete B backup/restore acceptance. Aggregate provider/token/cost counts remain unknown.

## Ordinal-order follow-up within original budget

Root capture3 produced a private canonical137904-byte inventory,0600/uid1000/gid1000/nlink1, with20tables and no media. Read-only use of the existing Node validator rejected schema column ordinals at local-media.mjs:132: numeric11 preceded2. Java `SELECT ordinal_position::text ... ORDER BY ordinal_position` resolved the output text alias. Approved wave requires integer ascending. An in-memory-only diagnostic sorted numeric ordinals/recomputed related hashes and then passed the existing validator; the retained artifact and all runtime resources were untouched. Root explicitly extended T128 writable scope to RecoveryInventory.java before this follow-up.

New checkpoint `ordinal-order/`: estimate12–20 lines before writing; actual10 added+removed lines (SQL2, test8), below400. Existing actual PG16 production runner test now asserts strict numeric ascent across all20schemas. Red command matches initial scoped integration command, recorded in `ordinal-order/red-native.log` and `red-results.xml`:1 actual PG test failed with `numeric column order: cms_audit_event`, after Ready/Permit/inventory publication. No scaffold failure.

Minimal fix qualifies the original numeric catalog column: `ORDER BY information_schema.columns.ordinal_position`. No Node subprocess/dependency, schema/hash-rule change or other production code change.

Green command:

```
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900 ./gradlew :services:cms-api:test --tests com.fallrising.cms.ops.RecoveryInventoryTests --tests com.fallrising.cms.ops.RecoveryInventoryMainTests :services:cms-api:integrationTest --tests com.fallrising.cms.ops.RecoveryInventoryMainIntegrationTests --tests com.fallrising.cms.contract.RecoveryInventoryIntegrationTests --offline --console=plain
```

`ordinal-order/green-native.log`: BUILD SUCCESSFUL in15s, both test tasks executed. Copied XML: Inventory units27, Main units16, actual PG contract9 and runner1; all53pass, zero failure/error/skip. Exact times remain in copied reports. New checkpoint preserves before/after/diffs, prior two-file manifest and final three-file hashes. Whitespace passes. Follow-up measured13:10:48Z→13:12:45Z; cumulative active estimate10minutes before report work (initial implementation/report~6, diagnosis~2, follow-up~2) of original25minutes, no reset. Root independently validates new real artifact through Node and owns full Java/image/capture gates. Prior captures/resources remain intact.
