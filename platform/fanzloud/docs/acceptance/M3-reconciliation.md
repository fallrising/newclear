# M3 explicit reconciliation — T-0442

**ACCEPT_ACTUAL_MAINTENANCE_U06_U07_AUTOMATED** on source
`86350871766bbfbe9d29325b49aae659c2d74c92`, [PR983](https://github.com/fallrising/newclear/pull/983).
U01–06 and the automated U07 journey passed independent review. **Owner operation
confirmation remains pending; full M3/FN07/platform and old Cloud AC04 are not complete.**
Owner approved PROPOSAL-M3-recovery; desk claimPR395 merged before implementation.

## Operation and trust

The original installation now has its original unknown intent positively confirmed
against the retained AP command. The same Web supports the formal Claude and Codex
routes, fixed-base diff/checks, candidate-only cross-vendor review and exact archive
reopening after Rust/AP restart. This is the original SQLite/AP installation, not
T-0449's separate acceptance store. All services are stopped; no standing operator URL.

Web explicit action → Rust immutable local intent → authenticated AP read-only exact
operator/route/key command receipt → existing atomic SQLite confirmation. No new
execution authority, schema or dependency. Missing/inconsistent/unavailable evidence
stays unknown and blocks new admission; refresh/restart never reconciles or resubmits.
A later explicit action may repeat the GET only. Confirmation of a cancelled run
means the submission is known, not coding succeeded. Arbitrary abandon/retry and
in-flight reasoning resume are not implemented; observed snapshots are not a full
AP event/tool transcript. AP remains the sole Worker/lease/lifecycle authority.

## Native U01–05 and necessary CI

- Meaningful AP/Rust missing-route and Web missing-action REDs retained before implementation.
- AP focused5, full838 PostgreSQL and M045 tests passed; native Ruff passed.
- Rust fmt/clippy/build and workspace/store/transport/lineage/integration tests passed.
  Initial full run had one existing logout assertion failure (61pass/1fail).
  Default-feature diagnostic passed, then the sole failed crate rerun with original
  all-features passed62. Root cause unproven; source/threshold unchanged and failure retained.
- Isolated Web33 plus P0 Web10 passed. Independent review found that remaining unknown
  buttons stayed disabled after readback; focused RED, correction and independent
  regression passed without clearing the admission lock.
- Project contracts55 and whitespace passed. Exact actual-source CI: Fanzloud41447377151,
  AP41447377294 (all3jobs), contracts41447377091, all passed. Final delivery-head CI
  is tracked by PR983; no unchanged native/live rerun for documentation closeout.

## Actual maintenance and original U06

Single-role maintenance took1.21s within its20min bound. Exact current-schema native
backup verified; original SQLite/config/role rollback material preserved privately.
New TCP authentication passed; old password explicitly failed authentication, followed
by another new TCP connection checking the installed verifier and unchanged data.
Exactly two known config references updated. No other credential, role property,
container or volume change. The container initialization environment retains the
revoked old value; it was not recreated. Database stopped after verification.

U06 ran12:47:18.984962Z–12:47:25.691598Z on2026-11-02. Exactly one explicit Web
reconcile confirmed key`2268a87e-3b2b-4ad1-95b0-58eaeed97b04` to original run
`acd1054a-080c-4104-9f70-e06e5b73f60b`, still cancelled/not_allocated. Original
key/request and the other confirmed intent were unchanged. Zero task/review/rework
POST, CLI, worker or VM start. Counts stayed18commands/9tasks/9runs/9jobs/106events/
3archives; retained archive bytes unchanged. After Rust/AP restart and a fresh browser,
the lock stayed cleared and three downloaded pairs were identical:

| Retained result | Bytes | SHA256 |
| --- | ---: | --- |
| Writer candidate | 1932 | `43a30ab60f57b7bb594d2b0b40684be47cef870f3da63706b42e3c838cfca8b6` |
| Diff | 285 | `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb` |
| Review archive | 1896 | `cbb4468cbe93b62fbea63c09dcf01013aad7e5ee3c38b3117d02312ccfa08d63` |

## Actual U07, human confirmation separate

One window12:59:25.717941Z–13:00:06.782931Z,41.06s including cleanup. Exactly two
real CLI invocations, one4CPU/4GiB VM at a time, zero-warm, each<=600s:

- Claude writer`9c20ec74-f940-46fd-81e6-064b9dee93eb` repaired the inclusive endpoint;
  fixed base`55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`, unit-test check exit0.
- Codex reviewer`54dc092e-a174-4af6-a48c-ac0ab54b3a33` inspected only the fixed
  candidate, returned first-round`accept` with3reasons. It did not run the writer's
  tests or inspect a full checkout; its native verification is candidate integrity.
- Browser selected the two formal profiles, submitted once per step, observed results,
  downloaded diff/checks/candidate/review, then reopened after Rust/AP restart.
  All3 before/after download pairs are byte-identical; no browser errors or forbidden
  mutation. No rework or second review: those branches remain native-only.

| New result | Bytes | SHA256 |
| --- | ---: | --- |
| Writer candidate | 1747 | `9faf56d6d8ccb05ce8f6b20e78c728db9de516fb890ae3ab62a0dea2d04468d7` |
| Diff | 285 | `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb` |
| Review archive | 1923 | `745de4e6cbfa5fe3878b186bb8e3e675d3c000b93d7d0ee281d1fc2212d1aabd` |

Pre-window launcher initially lacked a `sys` import and exited before main: no DB,
runtime, intent or CLI had started. Failure retained, import-only check passed after
correction; no consumed intent was reset. Independent review tightened failure-path
cleanup to an absolute cutoff with180s shutdown reserve before the first live window.

Owner availability was requested but no confirmation arrived. The automated journey
is accepted separately; services stopped immediately, without extending the window.
A future human operation window needs its own bounded authorization. This slice does
not make the whole original SDD complete or reopen old M1/M2 acceptance.

## Cleanup, evidence and remaining work

Both new runs succeeded with cleanup confirmed. Zero VM/claim/cgroup/reservation;
AP capacity remains1, draining,4CPU/4GiB/zero-warm. Runtime/registry/AP/Rust/browser/DB
stopped, old intents and archives preserved. No release, public deployment or new API
billing. Consumed intents/windows must not be rerun.

Selected private evidence: `backup/fanz-reconcile-20261102-t0442/`, with native failures,
review reports, bounded harnesses, safe receipts/downloads/screenshots, fixed binary,
AP runtime source and SHA256 inventory. Auth configs, role verifiers, DB dump and raw
provider/service logs stay only in protected private originals, outside Git/selected
artifacts. Source pin and cleanup readback remain authoritative over old dirty drafts.
Provider requests/tokens/cost, complete tool totals and precise active/wait time unknown.
Native independent reviewers1, reviewturns2; product CLI invocations2, not request counts.
T-0442/T-0447/T-0449 remain in_progress under their larger requirements.

## Owner follow-up preparation — 2026-11-02

[Owner operation preparation](M3-owner-operation.md) maps the exact FN07 When clause
to remaining human actions. Offline original-store and226-file hash checks passed;
no new live evidence. Read-only access alone does not prove owner submission/handoff.
Finite alternative windows are proposals awaiting explicit owner availability/choice;
services remain stopped and all previous consumed intents remain untouched.
