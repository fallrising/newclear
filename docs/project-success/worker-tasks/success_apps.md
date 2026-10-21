ROLE: WORKER
AGENT: native collaboration (inherit)
ID: T-001
Goal: Write project-specific SUCCESS.md contracts for exactly the listed components, in Traditional Chinese, grounded in current source and existing acceptance evidence.
Why: Owner wants each project to have a clear finish line and truthful usable-version qualification. Owner confirmed this rollout and normal delivery on 2026-10-21. T-0367 claim merged via desk PR97; target issue is 440, PR441.
Inputs to read first:
- <worker-worktree>/AGENTS.md and nearest AGENTS.md for assigned components.
- <lead-worktree>/docs/project-success.md
- <lead-worktree>/docs/project-success/PLAN.md and inventory.json
- authorized shared-skill checkout/agents/codex-team-superpowers/skills/codex-task-worker/SKILL.md
- authorized shared-skill checkout/agents/codex-team-superpowers/docs/specs/initial-plugin.md
- Explicit canonical skill source authorized shared-skill checkout @ 6240b548b2548a6f5ecb87c1661a1931967620b2; native workers, no external CLI routes.
- The README, SDD, STATUS, roadmap, task board, latest evidence and actual startup/API source under each assigned component. Read selectively; don't paste huge history.
Scope (may touch):
- <worker-worktree>/apps/cloudform/SUCCESS.md
- <worker-worktree>/apps/cms-scaffold/SUCCESS.md
- <worker-worktree>/apps/flowshot/SUCCESS.md
- <worker-worktree>/apps/loom/SUCCESS.md
- <worker-worktree>/examples/bite-pi/SUCCESS.md
- <worker-worktree>/gateways/pokercase/SUCCESS.md
- <worker-worktree>/labs/aweshore/SUCCESS.md
- <worker-worktree>/labs/bee-swarm/SUCCESS.md
- <worker-worktree>/labs/browser-fingerprint/SUCCESS.md
- <worker-worktree>/labs/eru-vps-mvp/SUCCESS.md
- <worker-worktree>/labs/m4-seat/SUCCESS.md
- <worker-worktree>/labs/mithril-research/SUCCESS.md
- <worker-worktree>/labs/open-compute/SUCCESS.md
- <worker-worktree>/labs/openmmo-lab/SUCCESS.md
- <worker-worktree>/labs/openviking-context/SUCCESS.md
- <worker-worktree>/labs/pg-jev-router/SUCCESS.md
- <worker-worktree>/labs/zircon-godot/SUCCESS.md
- <worker-worktree>/tools/cc-quota/SUCCESS.md
- <worker-worktree>/tools/codex-usage/SUCCESS.md
- <worker-worktree>/tools/streaming-converter/SUCCESS.md
- <worker-worktree>/docs/project-success/reports/success_apps.md (your own report and concise process log)
Out of scope (must not touch): All other files, including README/AGENTS, product code, original SDD, root plan/board, other worktrees, commits/pushes/tags, live services, paid providers. No delegation or human questions. Do not commit. Orchestrator integrates your new files.

Format:
Frontmatter exactly includes project, purpose (one concise Chinese line), kind (application/service/tool/lab/reference/archived), mainline (complete/incomplete/not-applicable), usable_tag: none, reviewed: 2026-10-21, source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0. No quotes needed. Use not-applicable only for reference/archived with explicit preservation/finish criteria; it is not completed-product status.
Required headings: ## 主線與範圍 ; ## 驗收條件 ; ## 現況與缺口 ; ## 啟動與驗證 ; ## 可用版本 .
AC table has exactly 4 columns: AC ID (AC-01...), concrete Given/When/Then case, literal status (passed/historical/pending/failed), evidence link or specific missing-evidence reason. At least 2, usually 3-6 focused AC rows. All complete rows must be passed/historical; don't silently omit required mainline gaps. historical means prior recorded tests, NOT a current rerun. Evidence should link real relative files. Preserve relevant original milestone scope and non-goals; use honest explicit incomplete when mainline still lacks promised core capability. For broad projects, describe the usable slice as a slice, not completion of all planned work.
Mainline may be complete from precise historical acceptance if all original core criteria are actually done; it does NOT authorize a usable tag yet. usable_tag stays none in this assignment. End 可用版本 with the actual remaining qualification needed. Do not fabricate startup commands; link verified README/Makefile/package entrypoints and say when only design exists. Do not run full product builds or live integrations in this writing assignment. Use 60-120 lines per component max; enough specific substance, no generic filler.
Prior audit hints to verify (not authority): CMS core W0-W5 works but PP1 persistent operations remain; Flowshot is a scaffold; Loom has working Linux PTY prototype but incomplete full product; Pokercase old progress upper table is stale (some provider routes have real smoke); OpenCompute has real bounded M1-M7 lab proof, not general production platform; OpenMMO is not playable yet; pg-jev has real Postgres integration with fake provider only; retired apps/labs/tools must not be reactivated. Inspect each latest source.

Definition of done:
- [ ] Every assigned component has its own truthful complete contract, with concrete AC and gaps.
- [ ] Existing design/retirement boundaries retained; no unsupported new usable tag or production claim.
- [ ] Required checker passes for assigned files and diff is within scope.
- [ ] Report contains summary, exact checks/results, documentation and limitations; historical runtime results clearly labeled.
Verify with: python3 <lead-worktree>/scripts/check_project_success.py --root <worker-worktree> --contracts-only --projects apps/cloudform apps/cms-scaffold apps/flowshot apps/loom examples/bite-pi gateways/pokercase labs/aweshore labs/bee-swarm labs/browser-fingerprint labs/eru-vps-mvp labs/m4-seat labs/mithril-research labs/open-compute labs/openmmo-lab labs/openviking-context labs/pg-jev-router labs/zircon-godot tools/cc-quota tools/codex-usage tools/streaming-converter
Also run: git -C <worker-worktree> diff --check
Budget: one bounded leaf task, target 30 minutes; at most two repair rounds per verification failure. If missing evidence, document the gap; don't spend time pursuing live credentials. Do not delegate. Report concise path:line pointers and any scope blocker to root.
