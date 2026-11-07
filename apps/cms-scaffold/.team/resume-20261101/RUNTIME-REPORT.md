# PP1b local runtime qualification — T-0351

Status: live G07/E01 and final native gates PASS; independent source/local acceptance review complete; required final-head CI and merge still pending. This does not establish host recovery, backup/restore, formal deployment or full PP1 readiness.

Owner explicitly approved the published narrow local-tooling exception. PP1a§5.2 records it; old failures remain evidence. Existing prepare/compose/browser still require prevalidated full image IDs and never auto-pull. Official shared-cache Compose5.6.1 was also located by the supported CMS_DOCKER_COMPOSE absolute-path seam after the initial prepare failed because no Compose executable existed; SHA25647737f4236e6d3ccea7291995203f8f018058783b4c3a9469119811a0b5db8c0. No host config/trust/runtime dependency change.

## Root-cause correction

A real true-TTY initialization reached BOUND but failed before writing identity rows. Read-only diagnosis showed Flyway.validate's operation-finish callback requested a second logical connection from the mandatory one-connection Hikari pool. The code now borrows that existing connection and gives Flyway a Spring SingleConnectionDataSource with suppressClose; the outer try returns the connection, and pool size remains1. No guard weakened or extra backend admitted.

The actual-PG production-context regression first rejected Testcontainers' query-bearing URL as INPUT_INVALID (fixture setup, not the intended RED). After canonicalizing that fixture URL, it reproduced MAINTENANCE_INTERNAL_ERROR. The minimal fix passes, proving the same bound PID/epoch, one backend, zero initial principals, real migration checksum rejection and pool closure. Existing fixed-code error/redaction policy is unchanged.

## Observed acceptance

- Fresh verifier, untrusted browser TLS refusal, trusted runtime browser, same API restart and fresh verifier pass on the fixed new run.
- True PTY reads exactly two prompts with echo disabled; initialization exit0, valid result/COMPLETE state, initialized CLI PASS before any login.
- Exact production initialized SQL rejects seven same-count changes: admin assignment, permission surface/type/predicate/role, principal status, audit linkage. Each is in one rollback-only transaction; relevant semantic boolean becomes false, counts unchanged and all20table snapshots equal afterward. Full initialized CLI passes again before credential delivery.
- Real guard run passes PRE_CONNECTION and bound Hikari backend. Concurrent contenders, extra idle connection, API restart, target metadata drift, same-name extra backend, missing bound backend and replacement backend all reject. Each preserves all20table counts/hashes. Negative state and permanent lock remain preserved.
- Trusted accounts journey `PP1-AC02 formal accounts and explicit grants`:1passed22.5s, single worker/retries0, Secure origins and actual API, distinct operator and explicit grants, public access before/after grant, real SELF/confirmation/reference/purge/reset behavior. Only the approved one-shot client CSRF response is intercepted; successful writes and auth denials use real API. Trace/video/screenshots off; short0700 private socket directory,0600socket, one delivery then unlink; password only in driver/worker memory.
- Post-E01 same API container restart returned healthy and all20table counts/hashes remained identical. All four owned runtime projects (failed init, guard negatives, initialized socket-failure run, final E01 run) are stopped, with volumes/metadata/locks retained. Forwarder listener closed. No volume deletion or old-runtime adoption.
- API schema generation ran twice with no byte change; OpenAPI remains52paths.

## Retained failures and scopes

Initial failed run205a8e13b1164aefa83be7a364d1bec5 has zero principal/credential/permission/audit/session rows, no success result, FAILED_OR_UNKNOWN lock retained; containers stopped. Fixed run7b3374c5b9ef468db2b0cf3924f0e02a passed initialization and all SQL negatives but its driver socket path134bytes caused AF_UNIX path too long before browser launch. That run was not reset or reused; its password was cleared and containers stopped. Final run51617d95466e4184bdd3e8c293894c89 uses a short private socket and passes E01.

Mock runner first failed mounting tmpfs over missing directory inside readonly node_modules, then failed discovery because its isolated source copy omitted the referenced member JSON fixture. Both setup failures are preserved; corrected network-none runner passes all93tests in5.2minutes.

Final Java test:517/517 passed. First full integration execution:201/202 passed; unchanged BW1b public-list p95=134ms exceeds100ms (work99ms,patch42ms) while browser/runtime workloads ran concurrently. Keep this FAIL. After all owned runtime/browser workloads stopped (docker ps empty), the unchanged full integration suite passes202/202,zero failures/errors/skips in5m31s. Work/public/patch p95=59/52/17ms against150/100/80ms. Original thresholds/source are unchanged; the prior FAIL remains preserved. Concurrent load is a plausible cause, not conclusively established. No CI/merge acceptance yet.

## Source and evidence

API artifact is bound to bc14ba834c6b99da4834e80938b75ecae898103c with explicit worktreeDirty=true for the reviewed Java correction; exact JAR/image and changed source hashes are in RUNTIME-EVIDENCE.json. Frontend/scripts match the previously green source. Before publication compare final committed code bytes with this tested source; docs-only completion changes do not pretend the runtime was a clean HEAD build.

Private drivers/logs stay under ignored local/reconcile-20261101; public evidence contains only codes, counters, opaque IDs and source hashes. Earlier restricted-runner errors and obsolete October checkpoints are not erased. T113 provides independent final source/evidence review. Exact counters for complete provider/tool/active-wait history remain unknown/null; one existing reviewer follow-up, no new provider route.

## Root evidence-gate mapping

Historical card/source evidence remains under repository-root `.team/checkpoints/PP1b-20261009/`: T990(B01–B03),T995(B04–B08),T999(B09–B10),T991(G01/G02),T994(G03/G04),T007(independent G05/G06 diff replay),T005(G07),T998(Q01–Q07 independent closure),T997(Q08–Q10 staged replay),T006(E01a171/E01b178lines). T993's original SELF race is explicitly closed by T998 against corrected guarded mutation and deterministic unit/realPG Red→Green; its failed historical snapshot is not erased. New production/test correction is75handwritten changed lines; E01 cleanup is a separate small correction. This is retained per-card evidence, not a claim that the whole PR is under400lines.

Required native commands are in the historical EVIDENCE table for unchanged frontend/scripts, plus `JAVA_HOME=<verified JDK25> timeout 900 ./gradlew test :services:cms-api:bootJar integrationTest --no-daemon --no-parallel` (517unit pass,201/202integration first fail) and `JAVA_HOME=<same JDK25> timeout 900 ./gradlew integrationTest --no-daemon --no-parallel` (isolated202/202pass,5m31s). `timeout 920 python3 local/reconcile-20261101/mock-driver.py` invokes the unchanged `npm run e2e:mock` in the isolated network-none runner:93pass. `npm run gen -w @cms/api` twice leaves tracked schema bytes unchanged. Root `python3 scripts/check_project_success.py`, `python3 scripts/check_indexes.py`, and `git diff --check` pass after D01 doc updates.

Live acceptance is recorded by private `positive-driver.py` (fresh new attempt3), `node local/reconcile-20261101/guard-live.mjs`, actual helper-backed CLI and Playwright commands within those drivers; RUNTIME-EVIDENCE.json exposes only their nonsecret outcomes/source binding. Reviewer T113 inspected actual named logs/JSON and source; its PARTIAL status retains earlier failed attempts and delivery conditions, not an invented clean history. Root will judge the final superseding gates explicitly rather than changing historical FAIL entries to PASS.

Final T113 recommendation: no remaining local source/acceptance blocker in the bounded reviewed scope; normally merge PR334 after required final-head CI passes, then read back remote. PARTIAL report retains historical failed attempts and pending delivery; root does not reclassify it as an all-pass worker report. Tested Java hashes were rechecked unchanged before commit.
