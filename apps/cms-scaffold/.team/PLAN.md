# BW5 delivery plan

## Objective and authority

Owner requested BW5 continuation after BW4 merge. Follow BW5 section 0, docs first, preserve all earlier work and snapshots. No new dependency or deployment. Standing owner authorization covers commit, push, PR, required CI/review, exact-head merge and remote verification.

## Bounded assignments

- T-911: Codex high, isolated admin worktree; BQ-06/07/08 backend code and focused tests.
- T-912: Codex high, isolated media worktree; BQ-11 stores, service, projections, public/member count and safety tests.
- Root: BQ-10 index/filter/backfill and tests; additive runtime OpenAPI/BW5 contract, codegen and W2 consumers; preservation, integration gates, reports and publication.
- T-913: Codex Luna medium independent read-only source/evidence review; owns report only.

## Dependencies and gates

Runtime contract is root-owned and supplied read-only to workers for focused API gates. Workers never delegate or publish. Review each scoped diff before import. Backend tasks execute focused Red/Green; root executes complete native backend and frontend gates, mock E2E after Docker, unchanged performance thresholds, source/snapshot/contract checks and team report validation. No historical frontend/CI exceptions accepted.

## Progress

- BW4 source/merge/CI receipt confirmed; new clean BW5 delivery/admin/media worktrees created without modifying earlier trees.
- Read complete 2271-line historical BW5; section 0 records compatibility/security and scope overrides before implementation.
- BW4 immutable baseline captured; earlier snapshots remain protected.
- Implementation and final review pending.

## Source review and focused acceptance

- T-911 accepted: five production files preserve existing transaction/audit blocks and authorization order. Final eight-file hashes match root. Focused15 Java/API tests pass; original Red and resolved test-accessor/permission-fixture/YAML description failures retained.
- T-912 accepted: seven production files retain all current media visibility checks; final twelve-file hashes match root. Focused37 Java/API and11 real PostgreSQL cases pass, including member/public counts,21 unsafe media scenarios and actual SQL counts.
- Root BQ-10 Red observed two Java/API and two PostgreSQL failures on old behavior. Green55 Java/API and55 PostgreSQL tests includes published/work refs, principal-ref, disabled-ref andV10 backfill.
- W2 consumer Red showed uppercase errors lost the specific upload message; Green restores type/quota/size messages, including server-side413. Full395 frontend tests plus lint/typecheck/build/bundle pass. Final schema-description codegen/API32 rerun passes.
- No implementation changes pending. Independent source review found no concrete defect; complete integrated backend/performance/E2E evidence still pending.

## Final local acceptance

Root complete backend gate339 Java/API +140 PostgreSQL, all9 Gradle tasks executed, bootJar success. Frontend395 plus lint/typecheck/build/bundle and codegen pass. Serial mockE2E39/39 passed. Three original10k performance runs109/89/35,74/74/20,79/75/18ms pass unchanged limits. T-913 independently verified actual XML/logs/source/manifests and reports DONE with no concrete defect. Final431 sources,396 protected files,232 frontend hashes,8 snapshots andoriginal468 preserved. Evidence gate accepts BW5 as LOCAL_VERIFIED; no required local check failed or skipped. Historical resolved failures remain in delivery/scoped reports.

Owner standing authorization now permits commit→push→one PR→all required CI/review→exact-head merge→remote CMS tree/ancestry verification→handoff. No deployment, production-readiness claim, branch protection bypass or automatic next-wave implementation. Remote publication receipt is recorded in the PR and local handoff after merge.
