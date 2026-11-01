# PP1c implementation — T-0351

Started 2026-11-01T16:49:21Z. Owner explicitly approved reviewed131ed63f protocol and four sequential9/12/9/14subwaves. Approval-status head28886f9d; implementation waits PR333 required CI, normal merge and readback plus desk384 approval reference. Existing claim codex-gpt-6-pilot remains in_progress.

## Objective and boundaries

Deliver the approved local DB/media backup and isolated restore protocol through A/B/C/D, preserving existing v1 bytes, all20tables, media policy, session invalidation and original RTO origin. No new dependencies, permission expansion, offsite/formalhost/upgrade/scheduler, release/deploy or old runtime/volume cleanup. Overall SUCCESS AC-04/05 remain pending until their complete scope is proven.

## Routing and dependencies

A: C01/C02 Node strict canonical protocol; C03/C04a/C04d/C04c/C04b Java read-only inventory; C05/C06 exact offline dispatch. Two disjoint isolated writers; root owns offline dispatch after shared inventory interface is integrated. Each original card remains a separately measured checkpoint, <=400 handwritten changed lines including tests; exceeding requires root split before further work, never compressed tests or reduced checks. Worker cannot delegate or mutate Git.

B: L01/L02/L04/L05/L03 registry, H01/H02/H04 helper lifecycle, H03a/b framed media, C07/C08 capture composition. C: L03-dependent T01/T02 blank target, C09/C10a/b verification, C11–C14 restore orchestration. D: R01/R02/R03 recovery proof, R04 atomic revoker, T03a/b/T04a/b fixture/browser, C15/C16a/b/C17/C18/E01 integration and real isolated drill. Subwaves merge sequentially through normal PRs; no hand-built stacked branches.

Root owns this plan, SUCCESS/BOARD, integration, evidence-gate acceptance and publication. Independent bounded source/evidence review once per frozen subwave; targeted correction follow-ups only. Reviewer does not author product changes. Prior T114/T115 remain design/status reviews only.

## Verification and acceptance

Each behavior starts with a named assertion Red using a compile/import-safe scaffold, then focused Green. Save exact commands/results/line counts per card. Node24 protocol tests; Java25 unit tests; realPG16 inventory tests with existing isolated Testcontainers fixtures. Cross-language canonical vectors must agree, including astral key ordering, nulls, UTF8 and numeric boundaries. Preserve v1 regressions.

Before each subwave publication: root diff/scope/evidence review, required Gradle test/integrationTest, npm test/lint/typecheck/build/test:bundle and project-success contracts, task/report validation and staged whitespace. Runtime drill belongs to D and cannot be replaced with fake adapters. Same-source successful checks need not repeat without relevant changes. Mandatory exact-head CI and independent review must pass before merge; read remote SHA/content, update board/desk/journal.

## Cost and stops

A estimate90–150active minutes including workers/root/review/integration, 20minute progress checkpoints; subsequent subwave estimates updated from observed work. Per command build/test900s, CI observation round15min; no busy polling. Same failure initial reproduction plus at most2reasoned corrections; preserve original failures. Stop affected work for new policy/scope need, exhausted retries, material unbounded overrun or no progress; do not bypass gates.

No hard tool-count cap. Full outer/nested/provider/token/cost/retry/active-wait totals unknown/null without a mechanical session export. New worker launches tracked separately. Prior status review resumed one existing reviewer. Estimate is not a hard owner deadline.

## Initial evidence

Approval-only378docs/52project checks and T115 pass. PR333 newhead CI pending at plan creation. wt initial sandbox attempt failed on protected Git metadata; approved escalation created this isolated worktree. No product work before effective DOC_READY.

DOC_READY effective: PR333 merged96557d30 at2026-11-01T16:49:53Z after CMS41328068645 and contracts41328068562 success on28886f9d; HTTPS component diff empty. Desk384 merged36530f2 and remote task readback equal. T116 Node C01/C02 and T117 Java C03/C04a/d/c/b assigned separate96557d30worktrees; no Git/delegation. Root offline C05/C06 awaits inventory interface.

Checkpoint2026-11-01T17:04Z: T116 root-integrated/hashchecked;98Node pass. RootC05 expected20tests9assertionfailures; C06 initial20then27boundarytests pass; crosslanguage146bytevector SHAaedd61aa...e0a8 matchesJava/Node. T117 realPG row/catalog8tests pass, media finalpending. Fullnpmtest failed unchangedFrontfirstalbum loadingtimeout1/147 duringconcurrentGradle; other525webtests passed, helperstage skippedby&&. Preservefailure and isolateFront afterworkerbuildsfinish; no threshold/sourcechange. T118 independent review begins frozenNode/Main, waitsfinalInventory; report-only isolatedworktree. Journalruncreated, offline158runs/30tests pass, unpublishedpendingreview.

A receiptvalidator checks schema/hashshapes; parentreceipt rawSnapshotSha256/mediaInventorySha256 preimages were not explicitly defined. Root asked owner whether to bind DBsnapshot+mediaheader(recommended) or fullinventory alternative. No dependentC/D receiptcreation until answer; unaffectedA/B work may continue.

2026-11-01T17:10Z nativecheckpoint: isolated unchanged Front147/147 passes after worker Gradle ended, original loadingtimeoutFAIL retained. Other525webtests passed in original fullrun; v1helpers117/117 now pass. Lint/typecheck/build/bundle allpass. Root fullJava unit→PG integration serialrunning on frozen A-source-hashes. No assertion/timeouts changed. T117 source complete25unit+9PG; independentfinalreview underway.

Late T118 materialfinding: Linux invalidUTF8 filename bytes can collapse viaPath.toString into identical/reconstruction-invalid objectKeys. C04c parentrequiresunique/preservablekeys. Publicationheld; T117 bounded15minute followup adds actual0x80/0x81namedRed, roundtrip+uniquecheck, focusedGreen within originalC04c<400budget. Otherpassedchecksremainhistoricalsameunaffectedsource. Aftercorrection rootfullJava/PG rerun(requiredchangedinventory), sameFE/Node evidence reused. No policy/thresholdchange.

## Final fixed-source gate — 2026-11-01T17:35Z

The late filename and directory-membership findings are closed. Actual invalid UTF8 filename Red and intermediate membership FAIL remain in T117 artifacts; valid U+FFFD preservation and 27 focused unit cases pass. C04c totals 289 handwritten changed lines, within 400. Final inventory SHA is deeb34d64366a7e5bbd97273605f74935562e234802e92e2de8f67b2f1fa182b.

`JAVA_HOME=<existing JDK25> timeout 900 ./gradlew test integrationTest :services:cms-api:bootJar --no-daemon --no-parallel` completed exit 0, BUILD SUCCESSFUL, 17:27:07–17:33:06 UTC, measured 359.778 seconds. Fresh XML files from this run establish 564 unit and 211 PostgreSQL tests, all zero failures/errors/skips; native-java-results.json records their hashes. final-native-exit.json records actual command and exit. Previous results remain explicitly before-path-fix snapshots.

Final packaged jar SHA256 3f9e46de95da6282a695b707826bb98d71f63f9a9aa459266ec0e8ac704293a9 passed all four actual java -jar invalid-route smoke cases: exit 2, empty stdout, no Spring startup; jar-smoke.json records arguments/results. Original jar evidence is jar-smoke.before-path-fix.json. Node/frontend source unchanged, so their successful gates remain applicable. Repository lint targets frontend workspaces; Node ops behavior is explicitly covered by its separate 98-test command.

Twenty-four whitespace-bearing generated patch/XML/Red artifacts are preserved losslessly as UTF8 JSON wrappers, with verified decoded byte length/SHA in artifact-encoding.json. No failure evidence was trimmed. Independent reviewer verified wrappers and source corrections; final report/publication gates follow separately. Full backup/restore acceptance remains pending B–D.

Root evidence-gate acceptance 2026-11-01T17:38Z: T118 DONE independently confirms final source, all scoped local gates and journal facts. Actual report validator passes. A local implementation is accepted for normal PR publication; exact-head CI/merge/readback remain pending. No unresolved source findings; no B–D acceptance inferred.
