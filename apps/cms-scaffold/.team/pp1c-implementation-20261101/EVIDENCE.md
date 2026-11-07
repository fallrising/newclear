# PP1c-A verification — T-0351

Scope: approved C01/C02,C03/C04a/C04d/C04c/C04b,C05/C06 only. Root source snapshot is A-source-hashes.json; all nine product/test files match worker integration or root-authored dispatch. Parent policy, v1 registry/migrations/dependencies unchanged. A is inventory/protocol construction, not a restore drill.

| Required check | Command/evidence | Result |
| --- | --- | --- |
| Protocol Red/Green | node --test scripts/ops/recovery-protocol.test.mjs; T116 report/checkpoints, root protocol-root.log | PASS98/98; original namedRed retained |
| Inventory Red/Green | T117 commands.md / final XML / patches; root verified hashes/counts | PASS25unit+9PG16, all5card limits<400 |
| Offline dispatch Red/Green | ./gradlew test --tests '*CmsApiApplicationTests' --tests '*RecoveryInventoryMainTests' --no-daemon --no-parallel | C05 expected20tests9assertionfailures; C06 final27focused+1crosslanguagevector PASS; raw/summary evidence inC05/C06 |
| Crosslanguage bytes | Java+Node vector including integer-like keys, supplementary Unicode, null, bytea/newline and >2^53 decimal string | PASS same146bytes SHA256aedd61aa4377225296140bd0c166259a7aa94016ec6236cbc45562b7f894e0a8; control escaping also verified byT117 |
| Full Java unit | JAVA_HOME=<existingJDK25> timeout900 ./gradlew test --no-daemon --no-parallel | PASS562/562,0fail/error/skip; 28s |
| Full PostgreSQL integration | JAVA_HOME=<existingJDK25> timeout900 ./gradlew integrationTest --no-daemon --no-parallel | PASS211/211,0fail/error/skip; same original child completed BUILD SUCCESSFUL in5m44s. Work/public/patchp9568/52/15ms pass originallimits. Toolwrapper143 observation retained; no rerun. |
| Workspace tests | timeout900 npm test | Original525otherworkspacePASS; Front146/147with1loadingtimeout, helperstage skippedby&&; failure preserved |
| Affected scope verification | timeout900 npm test -w @cms/web-front afterallotherownedbuildsstopped | PASS147/147,28.07s versus55.11s firstscope; no code/thresholdchange. Loadhypothesis supported bychangedcondition, not provenunique cause |
| Existing v1 helpers | timeout900 npm run test:pp1-local | PASS117/117,0skip |
| Frontend static/build gates | timeout900 npm run lint; npm run typecheck; npm run build; npm run test:bundle | allPASS; existinglockfile npmci, no dependencychange |
| Project/worker contracts | python3 ../../scripts/check_project_success.py; teamctl validate-task T116/117/118; validate-report T116/117 | PASS52projectchecks/alltaskreports; T117 workerformatcorrected onintegration afterinitialfailure, originalretained |
| Independent review | T118 inreviewworktree | Source/evidence no material blocker; PARTIAL pendingfinalrootgates/journal |
| Publication | normalbranch/PR/exact-headCI/merge/readback | PENDING; noAcommit/PRyet |

Each Gradle command uses existingJDK25 and max900s; Node24 existingbinary. Exact detailedcommands/results are in reports and local logs, compactRed/Green summaries/hash manifests checkedin. Nodeops tests run separately from npm's existingv1helperglob; no claim they are included bycurrentCI npmtest. RequirednewheadCI will be checked afterpublication.

First fullPG toolsession exit143 was a transport/process-observation failure; the unchanged child subsequently completed successfully. Exact remainingownedprocesses were wrapper381981,daemon382018,testexecutor382173 undertimeout381980,sourceworktree matched. Read-only jcmd identified ListQueryPerformanceTests fixtureinsert; no sideeffects retried. Originaltimeout15min was preserved. FinalBUILD SUCCESSFUL/211completeXML and allidentifiedprocessesgone close the observation gap; no gatewaiver.

No offsite/formalhost/upgrade/ops/release/deploy/oldruntime cleanup. Parent receipt hashpreimage clarification is pending onlydependentC/D; A validators checkexactschema/hashshapes and explicit bindings without claiming realproof. OverallAC04/05staypending.

Late review gate (before publication): T118 found unvalidated rawfilename→Unicode objectKey conversion; correction pending. Above native passes apply to before-path-fix source hash snapshot and do not override the material finding. Root publication remains held; fixed-source nativeJava/PG and exactdiff review required. Jar packaging/4invalidroute actualprocess smoke passed onprior source, preserved in jar-smoke.json; rerun onfinaljar afterfix.

## Final fixed-source gate — 2026-11-01T17:35Z

The late filename and directory-membership findings are closed. Actual invalid UTF8 filename Red and intermediate membership FAIL remain in T117 artifacts; valid U+FFFD preservation and 27 focused unit cases pass. C04c totals 289 handwritten changed lines, within 400. Final inventory SHA is deeb34d64366a7e5bbd97273605f74935562e234802e92e2de8f67b2f1fa182b.

`JAVA_HOME=<existing JDK25> timeout 900 ./gradlew test integrationTest :services:cms-api:bootJar --no-daemon --no-parallel` completed exit 0, BUILD SUCCESSFUL, 17:27:07–17:33:06 UTC, measured 359.778 seconds. Fresh XML files from this run establish 564 unit and 211 PostgreSQL tests, all zero failures/errors/skips; native-java-results.json records their hashes. final-native-exit.json records actual command and exit. Previous results remain explicitly before-path-fix snapshots.

Final packaged jar SHA256 3f9e46de95da6282a695b707826bb98d71f63f9a9aa459266ec0e8ac704293a9 passed all four actual java -jar invalid-route smoke cases: exit 2, empty stdout, no Spring startup; jar-smoke.json records arguments/results. Original jar evidence is jar-smoke.before-path-fix.json. Node/frontend source unchanged, so their successful gates remain applicable. Repository lint targets frontend workspaces; Node ops behavior is explicitly covered by its separate 98-test command.

Twenty-four whitespace-bearing generated patch/XML/Red artifacts are preserved losslessly as UTF8 JSON wrappers, with verified decoded byte length/SHA in artifact-encoding.json. No failure evidence was trimmed. Independent reviewer verified wrappers and source corrections; final report/publication gates follow separately. Full backup/restore acceptance remains pending B–D.

Root evidence-gate acceptance 2026-11-01T17:38Z: T118 DONE independently confirms final source, all scoped local gates and journal facts. Actual report validator passes. A local implementation is accepted for normal PR publication; exact-head CI/merge/readback remain pending. No unresolved source findings; no B–D acceptance inferred.

Publication closed: PR955 headfc2969a28aff1adf72a2053b95096cd83a48d84f passed CMS41332354599 and contracts41332354518; normal mergeb0bf709fb687f4a23df868a8d123e5fa447959a3 at2026-11-01T17:44:55Z. HTTPS fullcomponentdiff to reviewedheadempty. T118 DONE and local564unit/211PG/98Node+4jar smoke remain the scoped evidence. Journal230 mergedbf77165d and ownrun remote bytes match. Manual17:38Z acceptance label above was approximate, entered before actual17:36:23Z commit; Git/tool timestamps are authoritative. A is delivered; completeB/C/D and AC04/05 remain pending.
