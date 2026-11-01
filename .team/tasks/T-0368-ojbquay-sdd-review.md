ROLE: WORKER
AGENT: native independent read-only reviewer
ID: T-452
Goal: Independently review the concrete Ojbquay mainline SDD proposal and its complete docs/evidence diff against owner instructions, existing product contract, actual tests and evidence.
Why: Required independent review before SDD PR; do not accept weakened retry timing or invented completed deliveries.
Inputs to read first: workspace AGENTS.md; repo AGENTS.md; systems/ojbquay/AGENTS.md; latest desk origin/main docs/operating-method.md; systems/ojbquay/SDD.md, SUCCESS.md, docs/product-spec.md, docs/messaging-semantics.md, docs/specs/m3-delay-scheduling.md and m4-push-consumer.md; docs/test-reports/mainline-sdd-20261022.md; evidence docs/project-success/evidence/ojbquay-sdd-20261022; git diff and untracked files under these scoped paths. Existing repair tree may be read, never written.
Scope (may touch): .team/reports/T-0368-ojbquay-sdd-review.md only. Read-only inspection elsewhere; no runtime/CI edits, no containers, no external mutations, no new network search or model services. No nested delegation.
Out of scope (must not touch): All code/tests/source docs, Git state, existing repair worktree, other projects, .team/PLAN.md. Report only.
Definition of done:
- [ ] Check ten-repository coverage and limitations, original-vs-reconstructed SDD distinction, no unsupported exhaustive claim.
- [ ] Check purpose/scope/design/Given-When-Then fixed ACs/verification/non-goals against original promises. Find unintended expansions or silent weakening; AC-01..05 must retain IDs.
- [ ] Check retry first delivery, no warmup, thresholds, measurement anchor, current response-end deadline and preserved failures. Distinguish current main119-pass from preceding repair132/1fail and later20-pass.
- [ ] Check pre-lock reference evidence gaps, test names, relative links, public data hygiene, exact owner approval clause and actionable confirmation.
- [ ] Return ACCEPT or REWORK with file:line findings and required corrections; do not declare product completion or owner approval.
Verify with: Read actual SDD/diff/evidence JSON/logs, inspect mapped tests; git diff --check; report contract STATUS and Summary/Verification/Documentation/Risks and Follow-ups, verification entries exactly ending — passed|failed|skipped. Validate report via workspace agents/codex-team-superpowers/scripts/teamctl.py.
Budget: 25 minutes; one review plus one evidence-driven correction review; no recursion. Provider/tool totals unknown unless measured.
