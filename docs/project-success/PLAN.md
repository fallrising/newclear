# Project success delivery — 2026-10-21

Issue: https://github.com/fallrising/newclear/issues/440
Requirement: T-0367 (owner confirmed; claim merged and read back).
Baseline: b97319d74f8442b5173ef42be72a0aa757d87df0.
Canonical skill checkout: authorized shared-skill checkout @ 6240b548b2548a6f5ecb87c1661a1931967620b2. Native collaboration workers inherit model; external CLI routes are not used and no CLI pin is upgraded.

## Goal and scope

Roll out the contract in [project-success.md](../project-success.md) to every entry in inventory.json. Preserve original scope and dormant/reference status. No implementation of missing product features, deployment, paid provider calls, force pushes, or broad permission changes. Owner authorized documentation/AGENTS changes, normal PR delivery, and evidence-qualified annotated usable tags.

## Definition of done

- [x] Every inventory entry has an evidence-backed SUCCESS contract and README/AGENTS links.
- [x] Status/gaps and concrete AC match current source and existing specifications.
- [x] Repository index and structural validation pass; invalid fixtures demonstrate the validator rejects missing/contradictory records.
- [ ] Required local checks and CI pass; independent read-only review accepted.
- [ ] PR merges normally and remote contents are read back.
- [ ] Qualified usable tags are published/read back; unqualified components retain explicit gaps and no usable claim.

## Board

| Task | Scope | Start | End | Last activity | State |
| --- | --- | --- | --- | --- | --- |
| contracts | Component SUCCESS files (bounded workers) | 2026-10-21T15:15:00Z | — | 2026-10-21T15:15:00Z | completed (see reports) |
| integration | Root policy, navigation, index and checker (orchestrator) | 2026-10-21T15:15:00Z | — | 2026-10-21T15:15:00Z | in progress |
| qualification | Scope-specific startup/core-flow evidence and tags | — | — | — | planned |
| review | Independent read-only review and required CI | — | — | — | planned |

## Verification

`python3 scripts/check_project_success.py`; `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v`; `git diff --check`; affected repository-native CI. Product qualification commands are chosen from each project's own contracts and recorded separately, with failed/skipped evidence visible.

## Decisions and evidence

- 2026-10-21: owner confirmation received. Claim card passed desk check (367 docs), 62 tests and hosted CI before merge PR97.
- SSH agent signing stalled; used the existing gh HTTPS credential helper per command without persistent auth changes.
- Actual provider/model request counts are unknown; native agent launches and verification commands will be recorded. Tool counts from earlier turns cannot be reconstructed exactly and are unknown.

## Qualification and integration snapshot

- All 79 contracts independently integrated and structurally checked: newclear 39, kernel 40. README/AGENTS navigation covers every item; generated indices distinguish unfinished/unverified from verified versions.
- Independent review reproduced false-positive qualification and category/path-discovery defects in the new checker. Regression suite expanded from 10 to 15 and all cases pass; exact unique identity, contained paths and all-change CI now enforced. Original ojbquay 150 ms failure restored as a required failed AC.
- Nine local qualified candidates: four newclear scopes and five kernel native kits/core. Positive HTTP/browser tests do not override transfer root-symlink failures; ts-upload/download retain no tag. Wotar retains failed lint and skipped certificate cases; no tag.
- Product runtime/dependency/config files remain unchanged. Dormant/archive investment states remain preserved. Required final CI, independent review, merge and tag remote readback are terminal gates; their final facts are recorded in the issue delivery comment and T-0367 handoff to avoid claiming future remote effects in this pre-merge snapshot.
- Process journals are explicitly opted in by the task files, one bounded run per repo. They record facts, not owner acceptance. Task status remains subject to the owner standing workflow.
- Accounting: observed four native agent instances (three documentation workers plus one independent reviewer); reused workers received bounded follow-ups. External model CLI launches during this delivery: zero. Actual provider requests/tokens/cost and complete outer/nested tool totals across compaction: unknown. Worker-local measured intervals remain in their reports; no inference from tool totals to provider requests.

## Independent acceptance

2026-10-21T16:03:00.294168Z: [Independent final review](reports/independent-review.md) ACCEPT. Contracts workers accepted after orchestrator reran all 79 structural checks. Newclear qualification report remains PARTIAL with four qualified and two unqualified candidates; only the four proven scopes are accepted for tagging. Kernel native kit/core five candidates accepted after 68 tests on the clean committed navigation source. Both structural suites pass 15 tests. Final CI and remote publication remain gates, not presumed facts.
