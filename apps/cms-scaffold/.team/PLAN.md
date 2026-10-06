# W5 frontend hardening

Status: IN_PROGRESS — owner approved A–G (G on 2026-10-06); baseline W4 merge 3b7be596e32920268036d4eb91361972f52bc8ba. Historical T02 failure remains recorded below.

## Objective
Continue the generic CMS Front/Back/Admin hardening, preserving W0–W4/BW work. Documentation first; initial source/spec inventory and prescribed bundle split. Fixed budgets and product behavior are not weakened.

## Team
T-951 GPT-6.1 Sol high: isolated bundle measurer, tests and exact T02 splits. T-952 GPT-6.1 Sol high: source/deferred-test/quality-manifest inventory, read-only products. T-953 GPT-6 Luna medium: independent scope/spec evidence review. Root owns documentation, plan, integration, acceptance and authorized Git publication. No nested delegation.

## Sequence and gates
Inventory current source versus old blueprint; resolve factual drift before dependent implementation. Bundle Red/Green and actual budgets first; T02 failure preserves artifact and requests concrete blueprint amendment, no further product optimization without authority. Future gates: native checks, three full mock runs, Vitals, axe60, visual70, hardening, real14; no inferred pass. Review actual worker diffs and evidence with codex-evidence-gate.

## Preservation
New isolated worktrees only. Baseline hash manifest retained outside repository. No dependency/lock/backend/fixture changes; all existing modifications and snapshots preserved. Owner directly requested this milestone; no private ledger task ID is available and none is fabricated.

## Root checkpoint
T-951 trial source17files and evidence reviewed, not accepted: all3budgetgates fail; actual-App media regression confirmed. T-952 inventory reviewed; T-953 independently inspected actual17-file diff/hash manifest, confirmed0mismatches and both actualfailedgates; PARTIALreview recorded. Root10measurer tests passed, focusedE2E2passed/1failed. W5-AMENDMENT lists bounded A–D proposal. Preserve local candidate and failed artifacts; no publication from failed milestone.

## Approved continuation — 2026-10-05
Owner approved A–D. Status IN_PROGRESS. T-954 Sol high fixes provider and actual import boundaries; T-955 Sol high implements quality/Vitals/deferred Admin tests; T-956 Sol high implements disposable real-API runner/journeys. Root owns recorder, scripts, canonical CI, integration and evidence; Luna independent review follows frozen workers. Disjoint isolated writers, no recursive delegation. Required validation and budgets remain unchanged.

## Integration checkpoint — approved continuation
Actual provider regression corrected: root mock browser media/list/detail/composer/schedule 4/4 pass; worker actual-App provider5/5. Root recorder/measurer27/27 pass. Iteration3 Front102977/92160 fails, Back130889/Admin136589 pass. Final bounded iteration4 documented in W5§0.1.2 uses existing BrowserRouter component routing, not async whole-App. T-955 quality/Vitals source awaits completeness guard fix and root browsers; T-956 disposable runner19 contracts pass, real run pending. Canonical workflow authoring is not run yet, no PNG accepted. No W5 publication or completion claim.

## E approval and runtime checkpoint
Owner approved test alignment E on2026-10-05. Root native643+allbuild/budget gates pass; axe60pass; harness52pass. Hardening7/11 and mock92/93 preserve initial failures. T955 bounded rework updates only five newtestcases to acceptedW3/W4 semantics afterW5§0.3; root reruns failed/fullrequiredgates. Vitals/visual/real remainpending; noGitpublicationyet.

## Historical checkpoint — E complete, before F approval
E approved corrections are integrated and verified: hardening11/11 plus focused memberlink1/1 pass. Historical7/11,10/11 andmock92/93 retained; fullmock93threeconsecutive stillpending. Vitalscomplete25samples:album/projects/Back/Adminpass,clinicCLS0.0914948303>0.05 andmaxLCP3188>3125fail. Source/trace showsmismatchedprofile/vet/accountloadinggeometry. W5-VITALS-AMENDMENT proposesF bounded2iterations(currentrouteparallelmoduleload+clinicskeletongeometry); explicitownerquestionpending, noFproductedit. NoW5PR/merge/deploy. Canonical70PNG/real14/remoteCIremainpending.

## F approved
Owner『approve』authorizesF. W5§0.4writtenbeforeimplementation. T958 Solhigh ownsboundedFrontloadinggeometry/currentroutemodulepreload, max2measurediterations; root ownsindependentgates/integration/Gitafteracceptance. Ehardening11andmemberlink1passed.

## F iteration1 integrated — measurement active
Root reviewed and SHA256-verified the six T958 files, copied only that scope and retained worker Red/Green/static/build evidence. Worker Front147 tests, lint/types/build/isolation and bundle85206/130889/136589 pass. Root Front checks followed by complete25sample measurement are in progress; no Vitals success inferred. Prior complete failed attempt2 and artifacts archived before rerun. Canonical70 visual, fullmock93×3, real14 and final independent review remain pending. Buildx v0.37.2 official binary verified against release SHA256982ca20490b45ed1ec8d99795974d3d874a358f75938c9c237305010e6b7e548 in temporary Docker configuration; no system installation. Visual negative-control command exited1 as expected after10px red body outline, proving screenshot mismatch rejection without changing product baselines.

## F iteration1 accepted for remaining W5 gates
Root Front147/lint/type, productionbuild, isolation andfixedbundle pass. Complete25Vitals exit0:album median2208/max2332/CLSmax0.009015448;clinic2316/2324/0;projects2208/2232/0;BackCLS0.003442703;Admin0.007282745. Evidence w5-F1-vitals-raw.json andnormalized w5-F1-vitals.json; appendedVitals06–10 andbundle16–18. No secondFrepair required. Mock93×3 active; T959 Luna independently reviewsF/E source. ApprovedC draftPRauthoring remainsneeded forcanonical70; no merge beforeallgates.

## Canonical initial baseline accepted; real attempt active
DraftPR300 head d84738eb published underapprovedC. Initial CMS CI37349357448 java/java-integration/webpass; quality37349357513 axe60,hardening11,visual70pass oncanonicalUbuntu24.04.5/Chromium153.0.8010.12. Rootverified70artifacthashes andreviewedallscreens; baselineimported unchanged. Three serialfinalmockruns93/93each pass,ledgerMock02–04/Visual01 appended. T959independentreview hasno blocker; rootactual390/375/320widths show nooverflow/pageerrors,closing speculative320risk. Realattempt001uniqueownedstackbuilding; no successinferred. Nextcommitonlybaseline/evidence/docs thencomparison-onlyCI; nomergeuntilreal14cleanupandfinalevidencegate.

## Real acceptance stop; G proposal pending
Canonical comparisonCI37350721874 passes70, unchangedbaselinehashes, ledgerVisual02. Real001 fails beforejourneys dueunboundfactory; receiver-only tool repair passes24contracts/lint/types (precise isolatedRed retained; original broadRed inconclusive). Real002 passes10/fails2/serial-notrun2: firstauditdetailnull vsJSONassumption; boarddrag noPATCH. W5§5.6 requiresstop before assertion/productedits. BothfailedrowsReal01–02 appended; runtimeverified0ownedcontainers/volumes/networks/privatefiles forboth. W5-REAL-AMENDMENT G proposesmax2boundedharnessrepairattempts; ownerasyncquestionpending. Product/sourcebaselinesfrozen. Saveauthorizedtoolrepair/docs/evidence toPR300; no merge untilreal14andnecessaryCI.

## G approved continuation — 2026-10-06 (current)

HEAD35bc6634 and clean tree independently confirmed; PR300 OPEN/DRAFT, exact head all five checks SUCCESS. G approval supersedes historical pending entries. W5§0.5 updated before implementation.

T-960 Codex GPT-6.1 Sol high: isolated new worktree, only real Admin audit journey/owned preparation/global setup/helper regressions; root owns Back instrumentation and evidenced timing correction, full real execution, documentation, integration and publication. T-961 Codex GPT-6 Luna medium independently reviews frozen G changes/evidence in its own worktree. No worker recursion or Git/network/container mutation.

G attempt budget: 0/2 used. Before first run integrate bounded Admin change and board diagnostics; preserve original mouse operation for diagnosis. After observable timing/hit evidence, permit one bounded harness correction and second complete14 run. A product defect or exhausted budget stops repair and preserves failure; no reduced assertion. Final gates: focused contracts/lint/types/list14, real14/14, owned cleanup, preservation hashes/append-only records, independent review/evidence map, current remote CI and required review, merge verification and handoff. Existing product/quality evidence reused only while related source unchanged.

Owner requested work overrides missing private ledger ID; no fabricated Desk-Task. Ledger availability checked via existing session artifacts, and no unrelated private ledger is assumed authoritative. Public receipt uses component measurement record IDs only. Preserve all existing worktrees/BW1a snapshot.

T960 frozen4files independently diff-reviewed and SHA256-verified before scoped integration; task report validated. Worker31contracts/lint/types pass, intendedRed retained. Root final checks follow; no liveGattempt yet.

G attempt1/2 (real003) launched after root31contracts/lint/types/list14 pass. T961 independent review active in isolated worktree, source/read-only and report-only; final real/cleanup acceptance pending.

G1real003failed12passed/1boardfailed/1serialnotrun; Admin G verified; rowREAL-20261006-03 and0ownedcleanup appended. Pointer attachment lost because finally read closed page aftertimeout, disclosed in W5§0.5.1. G2final design only observableSelect/card hit/stability/drag activation/collision waits with unchangedmouse/security; immediatecheckpoint persistence. No confirmedSelect orproductdefect claim; stopifsecondfails.

## G final local acceptance — 2026-10-06

G2/2 real004 exit0,14/14/zero skipped/flaky, rowREAL-20261006-04 appended. Final diagnostics actually observe Selectlistbox1/bodypointer-eventsnone whilecardvisible, then0/auto/hitcard, dragoverlay1 andsolePATCH status=in_progress. All4ownedstacks verified0containers/volumes/networks/privatefiles. Root31contracts, list14, finalESLint/types pass;608preservedfiles/14titles unchanged. HistoricalG1failure andlostattachmentexplicit. Productsourcefreeze permitsreuseof648native,93mock×3,25Vitals,60axe,11hardening,70canonicalcomparison. T961 independent finalreview pending; publication waits currentheadCI aftercommit/push. No thirdGattempt, productchange, deployment or newmilestone authorization.

## Root evidence-gate acceptance and publication routing

T961independentDONEreportactuallyread/validated, no scope/securityblocker; allrequiredlocalartifactsinspected. RootacceptsT960andT961withinboundedscopes, notjusttheirclaims. G implementation/localgateaccepted withreal14/cleanup/31contracts/static/preservation/appendonlyproof. Current-headremoteCIisaseparatependingpublicationgate; rootwillcommit/push/updatePR300, requireallnecessarychecksSUCCESSandrequiredreview, mergewithoutbypass/force/deploy, verifyremoteancestry/CMS-treeequalityandrecordpublicationreceipt/sessionhandoff. VERIFIEDstatusindocsonlytakeseffectwhenPR300isactuallymerged.
