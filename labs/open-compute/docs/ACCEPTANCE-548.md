# Issue548 acceptance reconciliation — 2026-10-25

This is a read-only evidence audit, not a new runtime run. The current target is
`2c4abddf4ce69105d1b4ee8c894e8ef1835aa92f`. All seven reports below were downloaded
from successful [CI40114998185](https://github.com/fallrising/newclear/actions/runs/40114998185),
whose actual checkout was `eb48a57b7c00b1e1ffa36df28466af1a9dfcdf58`, not the PR head
or a local runtime's contract-only base. The component and all workflow files
were compared: only `docs/tasks/BOARD.md` differs. All35 final frozen source inputs
match both commits. [Binding and report hashes](evidence/2026-10-25-ci613-source-binding.json)
make this inheritance explicit; the existing local M4/M5/M7 qualifications retain
their own source identities and are not mixed into a fictitious single run.

| SUCCESS condition | Existing same-source evidence | Decision |
| --- | --- | --- |
| AC-01 normal restart/full cold restore | [M1](evidence/2026-10-25-ci613-m1.json), [M2](evidence/2026-10-25-ci613-m2.json): all8/all9 controls, original state and actual cleanup | Satisfied on current source |
| AC-02 resource/cold observations | [M3](evidence/2026-10-25-ci613-m3.json), [M4](evidence/2026-10-25-ci613-m4.json): all5/all5, bounded coverage and metadata limits retained | Satisfied; no capacity inference |
| AC-03 checkpoint crash/controlled retries | [M5](evidence/2026-10-25-ci613-m5.json), [M6](evidence/2026-10-25-ci613-m6.json): all5/all5 | Satisfied; process crash is not power loss or external exactly-once |
| AC-04 retained foreground trial | [M7](evidence/2026-10-25-ci613-m7.json): 20 expected commands including two expected refusals, three daemon generations, three normal stops, retained flags and removal | Satisfied; not a host service or soak |
| AC-05 integrated M4 cold_after_writes closure | [M4 lifecycle](evidence/2026-10-25-ci613-m4.json): cold_after_writes10 launches/10 waits, root0/nonforced, no open reader/thread, complete consumed snapshot/released locks; all three epochs closed, final actual ECHILD and removal | Satisfied; this uses storage_lifecycle facts, not the differently named functional_acceptance AC-05 durable-wait oracle |

All reports use actual UID1001/Linux x86_64/Python3.11.17 and the original pinned
v0.2.4 artifact. The M5 receipt preserves two exact root-first SIGKILL targets,
root actual-9, six GET-only original-state readbacks and both kernel closures;
ECHILD adds closure evidence and never replaces the crash stimulus. Final normal
SIGTERM0 and owned removal remain required. Original workload, limits, strict
projectors and refusal rules are unchanged.

## Delivered repairs and preserved failures

PR571 delivered typed failure diagnostics and30-day fixed-artifact retention;
its original four-profile local batch remains partial, including the failed M7
attempt. PR585 subsequently repaired/qualified M7; PR595 preserved the original
allowlisted observation failure reason. PR613 repaired/qualified M4 and M5 and
passed six necessary checks before normal merge07934581. PR622 closed the eight
maintenance board rows after that merge. Diagnostic D1/D2/D4, lifecycle L1–L3,
M4 K1–K4 and M5K1–K4 have their own implementation, review and test evidence in
the existing reports; no original failed batch is relabeled passed.

The original M4 parent-edge refusal, M5 CI40109462879 pre-SIGKILL child_missing,
expired-capability RED and351-test candidate's independent deadline RED remain
historical failures. New guarded implementations and source-bound qualifications
supersede the affected current behavior, not the historical observations.

## Remaining conditions versus unavailable history

No unverified runtime condition remains in the original bounded SUCCESS AC01–05
on this source. Required independent reconciliation review and this documentation
PR's publication/checks/merge are delivery gates; they do not require another
local runtime experiment. The published quickstart and original M1–M7 contracts
continue to define the operator path and limits.

Exact vanished historical generation/role and first background-failure time were
not recorded and cannot be reconstructed. They remain unknown, not a technical
precondition that can be satisfied by unbounded replay. A newly observed failure
or a material production/configuration delta would justify its affected test.

The bounded lab mainline may be recorded complete after this evidence review;
owner issue disposition remains separate. `usable_tag: none` is intentional:
creating a usable tag is a release operation and is not authorized this round.
There is no deployment, power-loss, HA, host-installation, long-running reliability,
universal Workers compatibility, capacity or external exactly-once claim.
