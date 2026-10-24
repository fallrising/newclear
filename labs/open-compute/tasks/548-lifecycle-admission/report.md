STATUS: PARTIAL

## Summary

T066 implements the reviewed M7-only same-PID owner/private SupervisedCapture.
Generic Process/Capture, upstream PID/exit receipts, manual unopted mode, public
schemas and M1–M6 remain unchanged. Init/serve stay dirty until the integration
parent validates kernel closure, actual owner exit/output and exact locked
binding, then commits clean. This supersedes T063's design-only checkpoint;
its two original causal probes remain unchanged.

## Verification

- T066-clean-red reproduced premature clean=true; corrected shutdown defers clean — passed
- Actual synthetic gates cover nested reap/double fork, FD absence,0/1/-9, phase/cleanup bounds, early ACK, owner/parent loss, cancellation, output, wait policy and binding/save failures — passed
- T066-resource-fixture-green: reviewed four-full-interval fixture passes against baseline and candidate production; all original assertions/production timing remain — passed
- T066-frozen-sdk311:318tests/39.636s on verified official Python3.11.17; all30 hashes stable, no unexpected children and final ECHILD — passed
- Root T069-root-offline independently reran318tests/39.283s on the same freeze; final ECHILD and no unexpected children — passed
- T067 independent implementation review and final source/document binding — passed
- T068-m7-trial1: one fresh original-artifact M7 trial/80.892s, all five acceptance checks,20 expected commands, three generations/normal shutdowns, retained state and explicit scope removal; unchanged source/no remaining owned container — passed
- T069-runtime-audit: strict report/diagnostic projection, all30 source hashes, runtime subset and sanitized public report/source binding — passed
- T071-offline-nosyspath:318tests/39.238s, Python3.11.17 with PYTHONPATH absent, exact final freeze and ECHILD/no unexpected children — passed

Frozen code/workload/build digest:
`71a4040e996cc06f6c8b6390d95d7e437b488f98b54fa3436ba95ac8d8c07b55`.
Protected receipts are in shared-launcher issue-sweep task T066-frozen-sdk311:
source-manifest.json, tests.log, test-result.json, result.json,
actual-m5-targets.json and verify_frozen.py under preserve/evidence.
The auditor matched/reaped only the unchanged real M5 test's exact exited
SIGKILL target, then required ECHILD. Its oracle/source is unchanged.

Earlier317/oneERROR remains failed. The unchanged resource fixture gave its
fourth fresh helper only50ms; baseline/candidate pairs reproduced helper_timeout
on system3.13 and verified CI3.11, including an escalated/native pair. Measured
successful helpers exceeded that margin. Root approved only four full test
intervals plus scheduled_slots==4; production bounds were not changed.
The old untraced exited child was not retrospectively identified.

First PR585 CI ran318tests but failed7 assertions/14errors because temporary
synthetic scripts could not import component modules without caller PYTHONPATH.
T071 makes those scripts/coordinators load the trusted path and clears ambient
PYTHONPATH in the two new test classes. No assertion or production byte changed.
Final freezeaa7c3c86935ee78ce04ed1542aa68469760cc30a400a43f59733c3ba47944fe2
changes only those two test hashes from the original runtime's71a404 freeze;
the public source binding records the exact bridge. Earlier CI remains failed.

## Documentation

SUCCESS/task/SDD preceded code. The current contract defines strict
READY/ADMIT/CLOSED/ACK with private nonce, actual ECHILD, original absolute cleanup
end, typed clean_pending, exact dirty binding and parent-after-exit clean commit.
STATUS supersedes the historical production-unchanged checkpoint.
The root runtime report and source binding are published under
docs/evidence/2026-10-24-m7-supervision*.json; their harness commit is the recorded
working-tree base, while the hashes bind the reviewed repair.

## Risks and Follow-ups

Independent review and the separately coordinated original-runtime trial now pass;
CI/publication and final acceptance remain root-owned. T066 ran no actual upstream
runtime, Docker/provider, staging/commit or GitHub mutation. Old trial FAIL and
historical M4 attribution remain visible; no claim of all548 races fixed,
AC-05 passed, complete mainline or usable tag is made.
