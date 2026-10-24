# Fleet task board

## T-0993 — Resume mainline acceptance (2026-10-23)

Owner instruction: [START_DEVELOPMENT_PROMPT](../../START_DEVELOPMENT_PROMPT.md).
Source: b7f2a4311d1135977ba273efba8e77702b908036 plus scoped working changes; existing unrelated changes preserved.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0993-1 | same-candidate schema/compiler checks; merged in #506 | AC-01 | done | 2026-10-22T18:01:58Z | 2026-10-23T01:44:24Z | 2026-10-23T01:45:09Z |
| T-0993-2 | isolated real Docker lifecycle; merged in #506 | AC-02 | done | 2026-10-22T18:01:58Z | 2026-10-23T01:44:24Z | 2026-10-23T01:45:09Z |
| T-0993-3 | Access web boundary evidence (owner revised scope); awaiting CF configuration and allowed email login | AC-03 | todo | | | 2026-10-23T01:41:40Z |
| T-0993-4 | persisted process restart/outage recovery; merged in #506 | AC-04 | done | 2026-10-22T18:01:58Z | 2026-10-23T01:44:24Z | 2026-10-23T01:45:09Z |

Order: AC-01 → AC-02 → AC-04; AC-03 depends on real external configuration. Rows become done only after authorized merge. Owner subsequently explicitly authorized milestone commits, pushes, PRs and merges; release/deployment remain outside this delivery.

## 2026-10-23 verification result (before Git delivery)

[Acceptance record](../evidence/2026-10-23-acceptance.md), [source manifest](../evidence/2026-10-23-source.json), and [real Docker result](../evidence/2026-10-23-docker.json). Native tests/example/vet/schema/build PASS. Final round03: ten real Docker checks and cleanup PASS. Reviewer ACCEPT; root evidence gate accepts these bounded candidate results. At that time AC-03 was pending external input; T-1001 below supersedes that scope, and root CI/merge have not run. Rows remain in_progress until authorized merge; no end time fabricated.

Source base/fetched main: b7f2a4311d1135977ba273efba8e77702b908036. Candidate fingerprint: 7416734bd434f50d901d6c421782aae6bae5728ac8d4c4037019ecd67af60245. No production-control takeover or existing-service stop. Generated state/evidence preserved outside repo; own containers/processes cleaned up.

Final documentation/evidence gate: Fleet and all 41 project success contracts/navigation PASS; all worker task/report contracts, local links, source/binary hash equality and git diff --check PASS. Earlier validator formatting failures and concurrent-document failures remain recorded in the acceptance history.

## Milestone delivery

Owner instruction: continue development and commit/merge a PR when a milestone is complete. Delivery branch `agent/fleet-contract-recovery-20261023` starts from `f64c7ef01532f717e963e7c1adec4cbae87f16e7`; only Fleet changes and root Fleet CI are carried from the shared working tree. Runtime fingerprint matches the independently reviewed and real-Docker-tested candidate. PR [#506](https://github.com/fallrising/newclear/pull/506) merged at `2026-10-23T01:44:24Z`, commit `a487a134aaef70e7eee29b5b98c50cb85e5fa376`. Final PR head was `6c1f2f021fd5b7136d4a6f67626c6c38f31780b5`; mergeability was CLEAN and both checks passed before the normal squash merge. The merged state/SHA/time were read back from GitHub. AC-03 remains pending external inputs, so no usable tag or full-mainline claim.

Delivery verification:

- [Fleet CI](https://github.com/fallrising/newclear/actions/runs/39885529743) passed `make test vet validate-schema build` on **Go 1.23.0**; [Project success contracts](https://github.com/fallrising/newclear/actions/runs/39885529728) passed.
- Isolated delivery-tree native tests/example/vet/schema/three builds also passed using Go 1.27.1; all 41 project contracts, local links and diff checks passed. The first sandbox attempt could not bind test sockets; its failure remains preserved separately from the authorized passing rerun.
- Runtime content fingerprint equals the independently reviewed/live-tested round03 source. The recorded Docker binary hashes remain those actually executed; delivery rebuild VCS revision/time differ and no new live run is claimed for them.
- Root evidence gate accepts **this merged AC-01/02/04 milestone**. AC-03 now follows T-1001: real Access web login remains pending Cloudflare test configuration and an allowed email. Full mainline remains incomplete with `usable_tag: none`; no tag, release or production deployment.
- This board-only follow-up closes the three completed rows using the actual implementation merge time, as required by the repository task contract.

## T-1001 — Access web scope (owner instruction 2026-10-23)

Owner removes the retired network mode; retain public/access, with Access web as the current operating path and public unused. Prior AC-03 scope is superseded by this explicit product decision.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-1001-1 | Remove retired mode from contracts, runtime, persistence and current docs; preserve public compatibility | AC-01 | done | 2026-10-23T06:59:40Z | 2026-10-23T07:21:51Z | 2026-10-23T07:22:26Z |
| T-1001-2 | Access-first examples and lifecycle/recovery verification, safe database upgrade | AC-02, AC-04 | done | 2026-10-23T06:59:40Z | 2026-10-23T07:21:51Z | 2026-10-23T07:22:26Z |
| T-1001-3 | Access allowlist and policy-before-entry regressions; real web login still awaits CF configuration | AC-03 | done | 2026-10-23T06:59:40Z | 2026-10-23T07:21:51Z | 2026-10-23T07:22:26Z |

T-1001 candidate evidence: [Access web record](../evidence/2026-10-23-access-web.md). Native suite, actual Docker ten-check lifecycle/recovery plus cleanup, legacy DB upgrade/rollback, source/binary identity and 41 project contracts passed. Initial independent review requested one SDD example correction, fixed and accepted in the focused follow-up. Delivery results follow below. The AC-03 row here covers the code guard regressions only; real browser login remains an external acceptance gap in SUCCESS.

### T-1001 delivery

Implementation PR [#522](https://github.com/fallrising/newclear/pull/522) merged **2026-10-23T07:21:51Z**, commit `1496049d37b4bc3d372dec1c94f919f87c07f28d`. Final head `648500d49cfbd74e8e8e51067719fa7af63039c5` passed [Fleet CI](https://github.com/fallrising/newclear/actions/runs/39916671479) (`make test vet validate-schema build`, declared Go1.23) and [Project success contracts](https://github.com/fallrising/newclear/actions/runs/39916671571). PR summary lagged the workflow; direct commit check-run API confirmed both completed successfully and REST mergeability was clean before normal squash merge. Merged status/time/SHA were read back.

Root evidence gate accepts this owner-requested removal and Access web implementation milestone. The three T-1001 rows are closed using the actual merge time; this follow-up changes only the task board. Runtime source remains the independently reviewed and real-Docker-tested fingerprint recorded above. Public is retained but unused; the current examples use Access web. Real Access browser denial/allowed-email OTP success remains pending under AC-03/T-0993-3, so full mainline and usable qualification remain incomplete. No production deployment or external Cloudflare-resource cleanup occurred.


## T-0380

Approved [task](../../fe-review/tasks/round2/task.md), R2-AC-7/E.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FLEET-FE2-1 | Approved M1–M9 presentation and synthetic runtime | R2-AC-7/E | done | 2026-10-24T09:51:27Z | 2026-10-24T11:13:28Z | 2026-10-24T11:13:28Z |
