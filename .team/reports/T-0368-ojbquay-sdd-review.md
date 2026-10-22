STATUS: DONE

# T-452 — Independent Ojbquay SDD proposal review

Desk task: T-0368. Review scope: concrete SDD proposal, scoped documentation diff, saved search/build evidence and mapped existing tests. Final decision after one bounded correction review: **ACCEPT for proposal publication**. This is a document/evidence review, not product acceptance, AC lock, SDD merge authorization or owner approval.

## Summary

The proposal supplies purpose, mainline scope, design, observable Given/When/Then behavior, stable AC-01 through AC-11, verification and non-goals. AC-01 through AC-05 retain their identities. It explicitly distinguishes reconstruction from recovery of the original SDD; main 119-test reference success from the failing repair candidate; and technical delivery from owner acceptance. The strict retry fixture retains the first delivery, arrival-to-arrival measurement, no warmup, no cost subtraction and the original strict upper bounds. The exact desk SDD owner-agreement rule is quoted and the requested decision is concrete.

The initial review required the following corrections. All five are resolved in the reviewed proposal; the original findings remain below for traceability:

1. **P1 — failure evidence combines different runs.** `docs/project-success/evidence/ojbquay-sdd-20261022/prior-strict-failure.json:6` names the repair-tree `resume-profile-full` XML. That XML's failure is 231 ms and its `retry_intervals_ms` is `[231,314,609]`; the JSON's `observed_intervals_ms` claims `[703,350,639]`. These must be separate run records or the digest/path must point to the actual 703 ms artifact. Do not alter the original failed XML or drop either failure.
2. **P1 — offset-reset hard gate is narrowed without a difference record.** `systems/ojbquay/SDD.md:176` replaces the original runtime pause/inflight contract with broker group quiet. `docs/product-spec.md` requires no offset change while any runtime has not confirmed pause; `docs/messaging-semantics.md` additionally requires fetch stopped and inflight drained or explicitly abandoned. `DefaultGroupOperations.awaitEmpty` observes EMPTY/DEAD/missing membership; this alone is not evidence that every runtime/inflight requirement holds. Restore the full contract in AC-09 and list the missing fault evidence, or explicitly propose a contract change with original text, reason, impact and owner decision. No unapproved weakening is acceptable.
3. **P2 — ordered and unordered retry paths are conflated.** `systems/ojbquay/SDD.md:46` describes all push business failures as durable `DelayCommand` handoffs. Existing messaging semantics and `OrderedPushRecordHandlerTest.retriesInlineUntilSuccessWithoutScheduling` require ordered retries inline with zero scheduled commands. Scope design step 5 and AC-04's durable ACCEPT/RELEASE scenario to unordered Share push, and state ordered inline retries and batch terminal behavior explicitly. AC-05 should identify its existing unordered fixture, without changing its timing oracle.
4. **P2 — AC-08 reference PASS exceeds its visible assertions.** `systems/ojbquay/docs/test-reports/mainline-sdd-20261022.md` marks AC-08 PASS, but the AC includes unresolved batch must not commit and resource bounds. The mapped `KafkaOrderedPushWorkerTest` checks successful ordering, independent-stripe progress, acceptedCount and lastError; `BoundedStripedExecutorTest` checks execution order. Neither proves the unresolved-batch commit barrier or saturation bound. Mark the combined AC PARTIAL and identify the missing executable probes unless a matching executed test can be cited.
5. **P2 — public evidence contains machine identity.** `docs/project-success/evidence/ojbquay-sdd-20261022/prior-strict-failure.json:13` copies a source hostname. Remove that field from the public derived excerpt while preserving the source artifact and its digest. Public repository guidance excludes hostnames and accounts.

Correction review:

- F1: the derived failure record now points to `notification-final-build` XML. Its SHA-256 was recomputed and matches `c71b05d518ceb54f6188e55f2244fdd516cbc205c258bc4fa3bdcb67a28d7fe9`; both failure text and saved timing output identify `[703,350,639]`. The older 231 ms source was not edited.
- F2: AC-09 and the invariant now retain every-runtime pause/fetch confirmation, inflight drain or explicit abandonment, broker quiet, preview, actual broker readback, audit and restore. The difference table and evidence matrix explicitly identify current quiet-only/readback gaps instead of treating implementation as the contract.
- F3: design step 4 explicitly states ordered inline retries without scheduled commands. Step 5, AC-04's durable retry scenario and AC-05 identify unordered Share PUSH. First delivery, no-warmup oracle and all strict thresholds are unchanged.
- F4: AC-08 is now PARTIAL and names the missing unresolved-batch commit and resource-bound probes.
- F5: the derived excerpt no longer includes the hostname. A full scoped evidence scan finds no private home paths. Original artifacts remain outside this public derived excerpt.

Reviewed content SHA-256 identities: `SDD.md` = `39b24103d58745b0c23eec78e028d7551651784e0f03a513f6d45d8fcda95581`; `docs/test-reports/mainline-sdd-20261022.md` = `bee4265e33d18551c0ea90b6ec18ff79659fac38200a045e3d33301874c4b534`; derived `prior-strict-failure.json` = `2be71480e32ec7d84ec5803b80d915e9a0520c9e8c1c03eef7b91f0ba643b706`.

## Verification

- Read workspace/repository/component instructions, assigned task, latest fetched desk `docs/operating-method.md` §0/§3/§6, original product specification, SUCCESS, messaging semantics and M3/M4 specs — passed
- Read complete tracked documentation diff and new SDD/report/board; `git diff --check` exited 0 — passed
- Independently counted saved reference results: 119 test cases, all passed; Gradle log contains BUILD SUCCESSFUL; Go log retains import panic; frontend log records 5 tests across 4 files — passed
- Checked SDD/report/board relative Markdown links with a local Python existence scan; zero missing targets — passed
- Inspected ten-repository coverage summary and both unindexed complete trees; 2,416 and 5,277 entries, both `truncated: false`; public conclusion is explicitly limited to searched default-branch content and carried-forward archived history — passed
- Inspected actual mapped producer rejection, push pipeline/transport/ordering, reset API and group operations tests; correction review confirms AC-08 PARTIAL, full original offset-reset hard gate, explicit implementation gaps and separate ordered/unordered retry paths — passed
- Compared corrected public failure JSON with the preserved `notification-final-build` XML; SHA-256, 703 ms failure and all three intervals agree — passed
- Public evidence hygiene follow-up confirms derived hostname removed and zero private home paths across scoped evidence — passed
- Reviewer runtime/build/container execution is not required by this read-only task; native build evidence was inspected, not rerun — passed
- `python3 agents/codex-team-superpowers/scripts/teamctl.py validate-report .team/reports/T-0368-ojbquay-sdd-review.md` (workspace validator, review worktree report) returned `validate-report validation passed`; final `git diff --check` exited 0 — passed

## Documentation

Only this report was written. Product documents, runtime/tests, existing repair worktree, Git state, containers, remote services, other projects and journal were not changed. No nested agents or paid/external model services were used. The original failed read caused by the sandbox loopback setup was retried as a specifically approved bounded read; it did not justify changing sandbox configuration.

## Risks and Follow-ups

Root was notified promptly of each substantive finding and the single bounded correction review confirmed the corrections above. Root remains responsible for final publication checks, any enclosing artifact digests and final-head CI. Search evidence does not prove the original SDD never existed or exhaust other branches/deleted objects/external attachments. Eight-repository raw private scans are intentionally retained outside this public diff; the public summary is a provenance index, not copied private source content.

SDD owner agreement, pre-lock reference gaps, final PR CI and repair qualification remain separate gates. AC-05 is still failed; no usable tag is justified. The main reference run and earlier successful repair subsystems do not establish a final same-source product qualification. Provider counts and cross-session tool counts are unknown; this review does not infer them from tool calls.
