# Fleet task board

## T-0993 — Resume mainline acceptance (2026-10-23)

Owner instruction: [START_DEVELOPMENT_PROMPT](../../START_DEVELOPMENT_PROMPT.md).
Source: b7f2a4311d1135977ba273efba8e77702b908036 plus scoped working changes; existing unrelated changes preserved.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0993-1 | Candidate PASS: same-candidate schema/compiler checks; awaiting CI/merge | AC-01 | in_progress | 2026-10-22T18:01:58Z | | 2026-10-23T01:41:40Z |
| T-0993-2 | Candidate PASS: isolated real Docker lifecycle; awaiting CI/merge | AC-02 | in_progress | 2026-10-22T18:01:58Z | | 2026-10-23T01:41:40Z |
| T-0993-3 | Real Cloudflare boundary evidence; awaiting account/zone and WARP client availability | AC-03 | todo | | | 2026-10-23T01:41:40Z |
| T-0993-4 | Candidate PASS: persisted process restart/outage recovery; awaiting CI/merge | AC-04 | in_progress | 2026-10-22T18:01:58Z | | 2026-10-23T01:41:40Z |

Order: AC-01 → AC-02 → AC-04; AC-03 depends on real external configuration. Rows become done only after authorized merge. Owner subsequently explicitly authorized milestone commits, pushes, PRs and merges; release/deployment remain outside this delivery.

## 2026-10-23 verification result

[Acceptance record](../evidence/2026-10-23-acceptance.md), [source manifest](../evidence/2026-10-23-source.json), and [real Docker result](../evidence/2026-10-23-docker.json). Native tests/example/vet/schema/build PASS. Final round03: ten real Docker checks and cleanup PASS. Reviewer ACCEPT; root evidence gate accepts these bounded candidate results. AC-03 is pending actual Cloudflare/WARP input, and root CI/merge have not run. Rows remain in_progress until authorized merge; no end time fabricated.

Source base/fetched main: b7f2a4311d1135977ba273efba8e77702b908036. Candidate fingerprint: 7416734bd434f50d901d6c421782aae6bae5728ac8d4c4037019ecd67af60245. No production-control takeover or existing-service stop. Generated state/evidence preserved outside repo; own containers/processes cleaned up.

Final documentation/evidence gate: Fleet and all 41 project success contracts/navigation PASS; all worker task/report contracts, local links, source/binary hash equality and git diff --check PASS. Earlier validator formatting failures and concurrent-document failures remain recorded in the acceptance history.

## Milestone delivery

Owner instruction: continue development and commit/merge a PR when a milestone is complete. Delivery branch `agent/fleet-contract-recovery-20261023` starts from `f64c7ef01532f717e963e7c1adec4cbae87f16e7`; only Fleet changes and root Fleet CI are carried from the shared working tree. Runtime fingerprint matches the independently reviewed and real-Docker-tested candidate. Remote CI and merge are pending at this entry; update this section with the actual PR/check/merge results. AC-03 remains pending external inputs, so no usable tag or full-mainline claim.
