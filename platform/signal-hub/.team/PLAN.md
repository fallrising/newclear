# M6 preparation delivery plan

Objective: prepare three real-source integrations, the OneFleet deployment acceptance pack, external liveness design, recovery runbooks and reproducible isolated synthetic verification. Real deployment and the full seven-day/outage/phone/yesterday-snapshot acceptance remain separate and incomplete.

## Authority and baseline

Published task claim and dependency acceptance were read back before product edits. Product base: 4db45139bac19d6ffc5f12c215a80faed51378da; component and CI match accepted M5. No runtime dependencies, host configuration, secrets, live producers/accounts, release or offsite service integration. Root alone owns this plan, shared design/docs, integration and publication. Historical M5 evidence stays in reports and STATUS.

Canonical CLI common source is pinned to 39fb407d71c7c5aae5f50a9bc01df6b3c215daa3, resolved from the installed skill symlink and verified tracked helpers. Private execution manifest preserves the canonical absolute location and inventory. External inventory/validate/plan ran: installed version/help succeeds, including Grok 1.0.52, but there is no matching reviewed live route; no CLI dispatch is authorized from reference-only entries. No provider installation/login/config/sandbox change.

## Model admission and roles

Scenario: standard-delivery with independent preparation work and reserved independent review. Native hosted workers use the native task/report contract and collaboration tools, not fabricated CLI registry records. Exact IDs frozen for bounded capability evaluation on 2026-10-14:

| Role | Exact native model / effort | Admission and rationale |
| --- | --- | --- |
| Source builder candidate | gpt-6.1-sol / high | Current provider tool exposes this exact ID; official model page opened; bounded read/write/test evidence pending. Suitable coding model at lower documented API cost, actual subscription cost unknown. |
| Independent reviewer candidate | gpt-6-astra / high | Current provider tool exposes this exact ID; official model page opened; bounded read/test/report evidence pending. Reserve stronger reasoning for recovery/auth/409 review. |

Official sources checked before first use: [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra). Both are distinct exact models in the OpenAI GPT-6 family; different-provider/family preference is not satisfied by the currently evidenced routes. External Grok/Claude help is insufficient. Model existence/client exposure does not prove account entitlement or task capability. Canary evidence must be independently inspected before implementation assignment; no silent model replacement. Backend snapshot beyond requested IDs is unknown unless provider exposes it.

Native pool alias: session-hosted; remaining amount/window/reset/usage/cost unknown (null), observed 2026-10-14. Manually reserve reviewer capacity before builder dispatch; no extra workers to consume quota. Initial admission: two useful 10-minute capability/research leaves, no retry; subsequent implementation 30-minute assignments, checkpoint at 15 minutes, at most one root-approved correction round per assignment. Root re-evaluates repeated failure rather than relaxing policies. No nested delegation.

## Work and evidence ownership

Each leaf has its own wt checkout at the full baseline and .local/run evidence. Candidate T-600 probes source auth/idempotence/Alertmanager semantics; T-609 probes restore invariants as independent reviewer. Only scratch evidence/report writes initially. Successful admission is followed by T-601 source contracts/examples/offline validator plus focused tests, a separate deployment preparation writer if useful, and fresh T-610 integrated independent review. Shared runtime contracts/STATUS/SDD/CI and all integration remain root-owned. Private manifests record absolute paths, run/writer IDs and snapshot digests; public files omit private infrastructure.

## Verification and completion boundaries

Before implementation, root writes docs/m6-design.md including scope, authorization, failure recovery and acceptance matrix. Preserve M1–M5 auth, immutable identity/409, seq, rules/backfill, subscription cursors, pending/inflight/DLQ/replay, archive/import and backup/restore. New offline tools cannot send network requests or accept synthetic evidence as real acceptance.

Required native gates: Go race/vet/format/build; web format/typecheck/unit/build; contracts/check.py; existing four HTTP suites and M6 isolated service suite; genuine sandboxed Chromium; new M6 offline package checks; native task/report validators; independent review and root evidence gate. Exact commands and results will be recorded in acceptance report. Failed/skipped checks remain visible; never increase timeouts or relax assertions/security to obtain a pass.

Only independently deliverable preparation is eligible for normal commit/push/PR/CI/review/merge. Real acceptance remains unchecked until three real sources run continuously seven days without unexpected409, deliberate producer outage yields silent after twice interval plus phone receipt, hub outage yields independent notification within five minutes, and previous-day snapshot restores in isolation. Record design acceptance, code merge, functional checks, deployment and operational observation separately. Preserve evidence README/commands/SHA256SUMS before cleaning only this run's merged worktrees. Tool statistics are observational; unknown cross-compaction counts/provider requests/usage/cost remain null.

Admission checkpoint: both native leaves executed repository reads and wrote bounded evidence. Their focused Go commands failed before tests because the standard executor mounts shared Go cache read-only; original logs retained. Root ran the same adapter/auth check through per-command approval review and it passed. Native mechanism is refined to allow reviewed, exact repository test commands using existing shared caches; this is not a provider sandbox flag or host security-policy change. One bounded follow-up per leaf will verify the same unchanged test; initial PARTIAL reports remain historical. Model IDs, official checks and source base unchanged.

Admission accepted after root artifact review: T-600 Sol focused adapter/auth passed (0.005s/0.006s); T-609 Astra focused backup/restore store passed (0.803s). Both worked at exact baseline, wrote reports/logs, passed native report validation, retained original denied runs byte-for-byte, and left tracked source unchanged. Native reviewed-test route is eligible for bounded tasks, not blanket permission expansion. Underlying backend snapshot/usage remains unexposed. Design was committed before implementation at f1889125f82a7689e166492fb1d2e44d20bef2c2. T-609 found an inaccurate draft recovery statement; root corrected it before that commit after checking Safe()/Sender.

Pre-integration contract correction: T-601 schema tests rejected the draft one-segment wildcard types. Root narrowed examples to deployment.release.* and inspection.check.* (existing schema requires two literal segments); no schema/runtime changes or validation relaxation. Original worker failure retained.

SDD alignment: root rechecked SDD01 M6 types and corrected release fixtures/design to release.deploy.* (release.deploy.succeeded), superseding the schema-valid but noncanonical draft deployment.release.*. No product schema/identity change. Initial M6 HTTP fixture reached backup successfully but read command JSON from stdout; existing CLI uses stderr. Corrected harness stream handling after inspecting main/maintenance and preserved original failure.


## Resumed integration checkpoint

Both preparation builders completed; root reviewed their full diffs/reports and source manifest hashes, compared existing source fixtures byte-for-byte and integrated only the assigned 17 files. Root found deployment tests depended on an ignored run directory: a fresh fixture checkout reproduced FileNotFoundError, then explicit test setup made all20 pass without relaxing assertions. The original worker report/log is retained unchanged. Source32 and deployment20 tests, default offline validators, existing deployment config schema/semantic check, shell syntax and actionlint pass after integration. The new M6 HTTP suite passes76 actual loopback responses and2 CLI commands. Backfill command shapes were checked against cmd/signalhub/backfill.go; --from is supported.

The resumed session rechecked the exact Astra official model page and native catalog on2026-10-14 before dispatch; current exact ID remains gpt-6-astra/high. No replacement, external dispatch or provider reconfiguration. Retain prior actual admission evidence; backend/account quota/cost remains unknown. One fresh independent review assignment T-610,30-minute bound with15-minute checkpoint and at most one authorized correction review, uses a separate candidate-HEAD worktree. Root reserves review capacity; leaves do not delegate.

Local full Go race10 packages, frontend28 tests, contracts and original203 HTTP/17 CLI results were read from retained command logs; executable Go/frontend content is unchanged. Original local Chromium launch/library failures remain retained and are not passes. The full10-flow sandboxed Chromium gate, independent integrated review, PR CI, merge and postmerge verification are pending. Real deployment/all four real M6 gates remain pending regardless of preparation delivery.


Independent T-610 review of ac90e4688040e6668dbdaa242a57fb9bbd353ec8 found R1: offline Alertmanager capture admission accepted malformed Unicode and unsafe/nonfinite numbers in identity or unused envelope fields, while the actual production API rejected the same bytes400 invalid_json. Root reproduced six Unicode and three numeric negative cases before correction; valid escaped Unicode pairs, safe integer boundaries and large finite floats remain controls. File admission now validates every string/key and whole-document existing JCS, without changing runtime/schema/mapping. All36 source tests, default checker and original contracts pass. Original independent matrix/denial and root Red logs remain retained. Fresh fixed-SHA T-611 correction review is required before acceptance; first PR CI continues for full genuine browser evidence.
