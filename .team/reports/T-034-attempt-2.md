STATUS: DONE

## Summary

T-034 attempt2, run DG-W2-20260923-01, dim-gate/mainline. Lead fixed this bounded verification extension in W2 contractrevision2/task/PLAN DG-D058 before implementation. Worker exclusively owns new `platform/dim-gate/src/demo/w2-handlers.test.ts` and this report. Production source ownership remains released from attempt1; all dependency files were copied read-only with lead authorization and must be excluded from this handback.

Worktree `/home/ckc/test/codex/newclear-dim-gate-w2-migration`; branch `agent/dim-gate/task/t034-resource-migration`; tested_commit/base `7086a443416fbc9876612e66bac889e83c8200ad` plus exact local test diff and published lead/T033 dependency bytes. There is no worker-created implementation commit. Final test SHA256 `9e9250fd2db31f17aebacd800e733a526beee588509baa2a3485ecb6498cb217`.

Added13 real MSW HTTP/typed-client tests. The first drives every18 W2 operation among91 registered operations. An HTTP wrapper validates actual success status, strict generated-contract response envelope and Cache-Control no-store before the typed client consumes each response; failures validate the strict error envelope. All business mutations use HTTP/canonical commands. No test writes the store to manufacture a successful workflow.

Dependencies:57 files copied from lead API/client/contracts/runtime/wire/handlers and baseline demo assertions, and final released T033 domain. Manifest `/tmp/t034-attempt2-dependencies-final.json`, SHA256 `f03040522c76da3d5e64c98189c42aed1bc6cf48063314ed9f7e59058b83f853`; T033 canonical16-file handoff `/tmp/t033-owned-manifest.json`. Attempt1's migration/seed/controller slice remains unchanged.

## Verification

- `pnpm exec vitest run src/demo/w2-handlers.test.ts`: final13/13 cases pass in1.41s after exact failure-code and helper typing corrections — passed
- `pnpm exec vitest run src/demo`:81/81 cases,9files,5.82s at exact final test bytes; log `/tmp/t034-attempt2-demo-exact-final.log`; includes all33 attempt1 migration/fixture/resource-persistence cases plus existing controller/M3/M4/W1 HTTP regression — passed
- `pnpm exec tsc --noEmit --module esnext --moduleResolution bundler --target es2023 --lib ES2023,DOM --strict --skipLibCheck --esModuleInterop --allowImportingTsExtensions --noUnusedLocals --noUnusedParameters --types node src/demo/w2-handlers.test.ts`: focused semantic validation of test and actual API/domain dependency graph — passed
- `pnpm exec eslint src/demo/w2-handlers.test.ts` — passed
- `git diff --check` — passed
- Pinned `/tmp/dim-gate-w1-evidence/teamctl.py validate-report .team/reports/T-034-attempt-2.md` — passed

Runtime Node24.18.0, pnpm11.18.0, component-local cwd. Final native checks cover this bounded verification scope; whole-product typecheck/build/browser/review/CI remain lead gates.

## Documentation

Test manifest and AC evidence:

| Case | Actual HTTP assertions | AC |
| --- | --- | --- |
| All18 W2 operations | strict status/DTO; draft PATCH; submit; independent approve; no premature Binding; configure failure; immutable retry snapshot/plannedIDs; two attempts; same RD/Ops Binding; cancel and reject | AC-WS-04/07/18 |
| Kafka identity and binding | same-cluster normalized duplicate409; different-cluster same-name distinctIDs; existing-topic consumer binding; one object quota and one Placement; duplicate binding409 | AC-WS-03/05 |
| Competing approvals | two parallel HTTP approvals compete for final quota; one409; reserved4096/used3072/available1024; cancellation frees reservation; next request completes; observed remains null | AC-WS-06 |
| K8s readonly projection | same CI between CMDB/service/resource; canonical namespace/workload; stale observedAt; private workload absent from CI.attributes; Data details404 | AC-WS-09/15 |
| Strict input refusal | unknown/duplicate/invalid query keys; invalid source/rawstate; extra actor/script fields; wrong discriminants/modes/profile/purpose; zero limits; missing reason; no domain mutation | AC-WS-07/15/18 |
| Authorization before replay | actual Admin scope revoke; original successful command key403; hidden detail404; lists/search/audit/notifications disclose no revoked object/change | AC-WS-07/15 |
| Partial scope isolation | Commerce cannot read Data allocation; private quota totals null; pool-only sees physical metadata without consumers; project-only and Admin cannot approve/execute or read payload | AC-WS-03/08/15 |
| Independent decision | multi-role requester self-approval403; second qualified Ops approves; qualified requester may execute afterward | AC-WS-08 |
| Idempotency/version | same-key same-receipt; changed-body409; staleversion409; simulated postcommit response loss retries same typed-client key and creates no duplicate | AC-WS-05/07 |
| Held identity response | successful Commerce service response held until Data identity becomes current; typed client rejects STALE_RESPONSE, current Data payload contains no old object | AC-WS-15 |
| Held policy response | explicitly granted multi-role user remains same actor; Admin policy change increments policy/epoch while resource response held; old response rejected and query keys use new identity | AC-WS-15 |
| Catalog governance | typed Admin Redis revision/publish makes old draft submit and submitted approval409 CATALOG_CHANGED; disable makes approval409 CATALOG_DISABLED; original frozen catalog snapshot/executions unchanged | AC-WS-07 |
| Original sources | Request and prod Release created through original APIs; WorkItem projects exact sourceIds/rawstates; original approval commands drive approved/queued states, new Change remains independent; Data list empty | AC-WS-04/15 |

Historical intermediate observations retained: initial HTTP run10/11 passed; test had guessed `SIMULATED_RESOURCE_FAILURE`, while authoritative executor returns `SIMULATED_RESOURCE_CONFIGURE_FAILURE`. Corrected expectation to exact code and added failed configure-step assertion; no production or failure semantics changed. Focused TypeScript then exposed overly broad fixture helper union typing; using exact Redis/Kafka discriminant return types exposed the dispatcher default's too-narrow inferred input. Declared the dispatcher `ChangeInput` boundary explicitly, then all static/runtime checks passed. No timeout/retry/gate relaxation and no hidden rerun of a failed product head.

## Risks and Follow-ups

Bounded verification DONE is not W2 ACCEPTED/MERGED. Hand back only `src/demo/w2-handlers.test.ts` plus this report; exclude every read-only dependency copy and preserve attempt1 report/history. Lead integrates this exact file, reruns whole-product native/browser/independent-review/latest-head CI gates against a real commit, and records canonical acceptance/GitHub durability. New code/report are LOCAL_ONLY in worker tree until lead commit and authorized SSH push. No worker commits, pushes, delegated agents, external notifications, deployment or cloud actions occurred. Worker releases attempt2 ownership after handback.
