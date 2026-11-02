# PP1c B resumed evidence — T-0351

Status PARTIAL. Owner approved PR956 and PR975; both specifications merged after independent review/CI and exact remote readback. Latest spec33a5498f, desk398 and journal237 delivered. No owner decision pending. B product remains uncommitted; C/D not started. Latest actual capture and independent root readback pass; T129 independent acceptance is DONE; publication remains pending. Historical checkpoints below are retained and superseded only where explicit.

| Check | Observed result / evidence |
| --- | --- |
| C07/C08 capture | named Red/Green; C08 original208 lines; C08b118; final20 focused tests pass. T124-I1 PG16 custom framing/zlib/20TABLEDATA/EOF and I2 request.startedAt corrected. C08/C08b logs/checkpoint snapshots retained. |
| Real PG16 custom archive | C08b/real-archive.log 1/1 pass: true15447byte pg_dump accepted and truncated copy rejected; C08b/real-pg16-summary.json hashes. Synthetic tables only, no semantic restore claim. |
| T123 real registry/token integration | initial200/200pass; H02b2d Docker exact missing-object60pass; H02b2e owned wrapper clear40pass. Checkpoint176/156/187/189/20/22 lines, each<400. Source files hashchecked on integration. |
| Full Node | `timeout 900 node --test scripts/local/*.test.mjs scripts/ops/*.test.mjs`: initial436/436pass, final445/445pass,0fail/cancel/skip,18.393s. combined-node-final.log. |
| Java | JDK25 `./gradlew test` and `./gradlew integrationTest --no-daemon --no-parallel`: success, FROM-CACHE for unchanged sources. XML564unit/211integration0failure/error/skip, java-results.json. Not a fresh PG execution. |
| Frontend tests | default workspace run Front146/147 failed existing album loading timing; other525 passed. Scoped unchanged Front `--maxWorkers=1`:147/147pass. Fail retained. |
| Static/build | lint/typecheck/build/test:bundle/measure:bundle all exit0, frontend-remaining-results.json. Runtime-specific VITE_API_BASE=https://api.cms.test:8443 build also exit0, build-pp1-origin.log. |
| Mock browser | hostlaunch all93 blocked by missinglibnspr4; failedlog retained. Existingapprovedimage networknone exact sourcecopy:93/93pass269.743s, mock-e2e-container.json/log. Container exited/retained. |
| Actual profile | firstfailure: Docker29 lowercase exactmissing-object text not recognized. Fixed at lifecycle/probe/registryclear with regression and no broad identity exemption. Secondattempt API+Node probes pass, then actualPGimage implicitly addsRWanonymousPGDATAvolume; exactpolicy rejects beforestart. real-profile.json plus pg-volume-blocker.json retain causal evidence. No full profile pass. |
| Proposal feasibility | pg-volume-proposal-probe.json: samePG16image, pg_dump/restore --version, networknone, additionalfixedROtmpfs suppressesanonymousmount, both0. Proposalonly; notproductacceptance. |
| Fresh runtime | firstprepare rejecteddefaultfrontendlocalhostorigin beforemutation; correctedbuild/newrun4422008970804730bed698cc679d4eac prepared/healthy. All3newcontainers nowstopped, data retained, capture notattempted pendingdecision. capture-runtime.json. OldPP1bworktree/runtimeuntouched. |
| Independent review | T124 PARTIAL: I1/I2/T121-I1 scopedclosures; PGmountspecdecision remains. T123 DONE onlyboundedworkerassignment. No all-Bacceptance. |

Generated/private files under local are not for Git. Compact logs/evidence under .team must remain available; no secrets/raw DB/media are exposed. Exact source manifest current-source-hashes.json includes retained maintenance compatibility files. New ignored scripts/local files must be explicitly staged when B is later delivered. Raw synthetic dump remains private local/pp1c-format-probe/actual-pg16.dump; manual compatibility runner depends on that fixture.

Aggregate tool/provider/token/cost/active-wait metrics are unknown/null. T123 approximate48/75active minutes; original estimates are not reset. Same issue initial+two reasoned corrections retained; no repeated failing profile run after discovering pending contract conflict.

## Approved PG policy and actual integration — current 2026-11-02

- PR975: head26d37514, CMS41444514347/contracts41444514350success; normalmerge33a5498fbfa5f1a9f7d055bde07459bde62ada84, exactremotechangedpathsdiffempty. T125DONE. Desk398 merged d5f7bbcc; journal237 merged5511e965; bothCI/readbackpassed. approved-pg/spec-delivery.json.
- T126: exactPGDATA ROtmpfsmask134lines; actualDocker CREATED blankendpoint correction75lines. No broad mount/network exemption. Focused177pass; fullNode483pass0skip, approved-pg/combined-node-network.log. Currenthashes in T126/final-source-hashes.json.
- Actualsame-imageprofile PASS in approved-pg/real-profile.json/log; no fake exec substitutions.
- Capture attempt1 failed CREATED network policy; attempt2 failed Java Ready inet text /32. Attempts1/2 artifacts andownedruntime identities retained, all3sourcecontainers stopped, locks/data retained.
- T128 Java host(client_addr) fix actualPG namedRed/Green;164linecheckpoint, focused16unit+1integrationpass. CompletefreshJava564unit/212PG pass0skip,378.281s, approved-pg/java-final.json/log. APIimageece90249 build from actualcorrectedJAR5c0c0ed5, jdbc-image.json.
- Capture attempt3 run19da25a9ecbc4053aa093976ec291d51 publishesrealprivateinventory137904bytes/20tables, butfails beforebundlecopy. Readonlydiagnosis found catalogcolumns sortedlexicographically bytext ordinal alias. In-memoryonly numericreorder+hashrecompute passedNodevalidator, provingcause but notsuccess. T128numericORDER BY regression/fix underway. Fullgate/image/capture mustsupersede priorJavaresults afterfix. All3sourcecontainersstopped; operationd1426749-87a1-4511-bb2a-aa61c6aadae7 failedlockretained. approved-pg/attempt3-capture-live.json.
- T127 independent review has accepted scoped mask/network/Java-address deltas, remainsPARTIAL pendingactualcaptureandfinalgates. No local-complete or restore claim.

- T128 ordinal regression/fix complete:10changedlines, actualPG Red then43unit/10PGGreen. Current APIimage79dcdf9e, JAR79483116; completeJava gate pendingafterfinalfreeze. Rootinventory copy/Nodevalidation succeeds on actualsmall137912bytes andlarge135522997bytes.
- Capture4 failedSOURCE_QUIESCED on0→1 backend; exactsourceunknown. Readonly20sdiagnostic didnotreproduce; nohealth/psql exemption orsourcechange. It remainsavailabilityrisk.
- Capture5 correctlyrejectsshortPGdump that exits0beforelivebackendpin; noarchiveaccepted. Small-sourceavailabilitylimitation isexplicit, notclosedbylargertest.
- Capture6 usesfreshsource3253eeb3 with4096deterministicauditrows/134217728syntheticpayloadbytes insertedbeforeworkflow (stream-fixture.json). It provesactualPGcontainer+operation/IPbackendlive andwrites23524738partialdumpbytes, thenrejectsDockerpaddedtopheader. Actualheaderonlyprobe confirms `PID                 COMMAND`. T126focusedparserRedGreenunderway; no guard/toolargvchange. Partialdump/failedlockretained, all3sourcecontainersstopped.

- Latest complete currentJava gate PASS at13:47:04Z:564unit/212realPG,0fail/error/skip,367.998s. test/integrationTest executed (compileIntegrationTestJava FROM-CACHE only). `java-final.json/log` and `java-final-image-binding.json` prove testedJAR79483116 equals actualimage79dcdf9e. Earlieraddress-onlyfullgate preserved asjava-address-only-*; no needanotherJava rerun unlessJava changes.
- Capture7 produces77261111bytedump afteractualprocess/backendpin; MEDIA_PACKfailsbeforeconsume becauseDocker none RUNNING internalEndpointID incorrectlyrejected. `none-running-probe.json` proves isolatedbuiltin-none shape withzeroaddresses; T127 interpretation accepts narrowexistingcontractfix, leaseendpointremainsnull. T126boundedcorrection underway; no wholecapturepass.

## Final frozen B acceptance inputs — 2026-11-02T13:57Z

| Required gate | Observed evidence |
| --- | --- |
| Current source | current-source-hashes.json:22files; T126none93linecheckpoint plus top22, network75, mask134; T128address164 and ordinal10. Every checkpoint includes tests and is below400. |
| Complete Node | approved-pg/combined-node-none.log:512/512pass,0fail/cancel/skip,24724.338ms. |
| Complete Java/PG | approved-pg/java-final.json/log:564unit+212actualPG,0fail/error/skip,367.998s. JAR79483116 equals actual APIimage79dcdf9e; java-final-image-binding.json. |
| Frontend/static/build/mock | Earlier same unchangedfrontend source:525otherworkspace + scoped147Front pass; lint/typecheck/build/test:bundle/measure all0;93mock pass. Initial Front timing/hostlibnspr4 failures preserved with bounded corrections. |
| Actual capture | approved-pg/capture-live.json:runbfe98fc8cd8d474880c9f92f1ce6367c, operation7e301694-fa4e-46ef-a6db-3bd0e90f40b6,13:53:28.685–13:56:08.900Z,success=true. Realcommands/registry/token/sourcehelpers, not injected successfuladapter. |
| Private artifacts | approved-pg/capture-acceptance.json/log:dump77263979bytes,inventory135522998bytes,media44bytes(emptyfiles); allhashes/modes0600/nlink1checked,manifest87ec627e. Pre/post fullinventoryhashidentical,20tables,4096syntheticauditrows. Marker/schema/journal COMPLETE,lockreleased. |
| Source policy | API restored/running afterfinish; driverthenstoppedexact3ownedcontainers. RootindependentDockerinspectconfirmsallstopped, dataretained. Newfailed/unknownhelperresourcesandoldPP1buntouched. |
| Final review/publication | T129 boundedcurrent-evidence review DONE, independentlycheckedsource/JAR/currenttests/privateartifacthashes/marker/journal/lock. Productcommit/push/PR/exact-headCI/normalmerge/remote readback andledgerstillpending. NoBdeliveryclaimyet. |

Actual media package here is the empty-media case; nonempty media framing/restore faults are covered by preserved H03 tests. Full real media/restored-data/session/browser/restart evidence belongsC/D and isnotclaimed. This largefixture success doesnotremove the approved fail-closed availability limit for shortPGtools withoutobservedbackend, or explaincapture4 transientextra-backendrefusal. Neitherguardwasweakened. `lastNonzero` inspectcode1 in a successfulsummary is expectedfull-IDabsenceafterverifiedhelperremoval, not a failedcapture.

Final capture invocation provenance: `approved-pg/capture-invocation.json` records the exact executed `capture-observed.mjs` command, observed exit0, times and readback driver/result hashes. The earlier `capture-live.mjs` is retained for attempts1–3; finaltrace camefrom observeddriver (attempts4–8), whosecommandwrapper records safe metadata after realexecFile and doesnot substitute outcomes. Hashrecordedatreviewreadback, notmisrepresented aspre-executionattestation.

Root evidence-gate acceptance: T129 DONE has been read against the frozen source, actual artifacts and requiredchecks; root accepts B implementation/localcapture within its stated limits. Source/card counts, tests and actualcapturehavevisible evidence. RequiredpublicationCI/normalmerge/remote readback remain pending and are not inferred from localchecks. Rootstaged whitespacecheck passed afterlosslessencodingof8generatedlogformatfindings; allrawoutput retained. Localprojectcontract52pass and18task/reportvalidatorspass (T129finalreportseparatelyvalidatedbyreviewer,rootrecheckatpublication).
