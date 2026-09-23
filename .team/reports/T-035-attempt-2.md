STATUS: PARTIAL

## Summary

DG-W2-20260923-01/T035attempt2. Product285b46f SSHsaved to draftPR36; correctedfocus/settledclock ae3bb49 SSHsaved. W2 remains NOT_ACCEPTED. Complete W2 scope retained; browser findings drive actual UI corrections and unchanged performance gate.

## Verification

- Fixed285b46f W2 Chromium0/4: interrupted finaltick before reload, in-flight audit at persona switch, invalid empty Adminbody422, real dialogEscape focusreturn defect; preserved artifacts test-results-w2-285b46f — failed
- Fixed285b46f fresh benchmark2/3: initial314429gzipbytes exceeds307200budget; engine/HTTPlatencypass; preserved isolatedperfworktree/logs — failed
- Fixedae3bb49 W2 Chromium2/4: stagingRedis+reload/scopedK8s/Admin pass; Kafka reaches success but HTMLpatternconsoleerror; axescrollable quota region lacks focus; artifacts test-results-w2-ae3bb49 preserved — failed
- Integrated T03413HTTPtests: working-diff312/312unit, typecheck,lint,demo build — passed
- Complete remaining browserbranches/smoke/regression/performance/uninvolvedreview/latestheadCI — skipped

## Documentation

PLAN DG-D060–062 records concrete findings and unchangedgates. UI fixes now restore actual initiatingbuttonfocus, wait persistedclock/readback before testreload, validAdmincommand body tests403, escapeHTMLpatternhyphen forvflag, keyboardfocusable namedquotaregion andsinglecolumn details at768. Source/resourceGuide clarifies operativeW2mocklinks and pendinglatercapabilities. T034attempt2handback exactSHAverified; attempt3 newisolatedbrowserworktree preserves alloriginalworkers. T033attempt2 domain-only lazycommand split runs separately withlead authorization. Nativechecks reference actualworkingdiff until containingcheckpoint frozen.

## Risks and Follow-ups

W2 remains unaccepted/unmerged. Keep originalfailures, no health exclusions, gatebudget increase or directstorebusinesssetup. Copy onlyfinalT033/T034owned handbacks withSHA checks; measurefreshfixedinitialJS andrunallnative/browser/smoke/isolation/regression. CompleteACmatrix before T036uninvolvedreview. RequirelatestPR36headCI green andmain/headreconciliation before authorizedmerge. Thenverifyactualmerge/tree/postmergeCI,releaseW2owner,andstartW3.
