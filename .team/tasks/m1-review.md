ROLE: WORKER
AGENT: native independent reviewer
ID: T-001
Goal: Review the M1 Graphify documentation reconciliation and the bounded M2 plan.
Why: Independent acceptance is required; runtime success must not be confused with production or token gains.
Inputs to read first: AGENTS.md; labs/graphify-lab/AGENTS.md; .team/PLAN.md; git diff; labs/graphify-lab/docs/milestones/development-pilot.md; original BOARD, SUCCESS and evidence; PR #759/#760 merge facts in BOARD. Desk T-0437 is claimed through desk #294.
Scope (may touch): Read-only review. Return report to parent; no filesystem writes.
Out of scope (must not touch): All files, Git state, external mutations, installs, nested delegation.
Definition of done:
- [ ] Confirm M1 changes accurately reconcile completed bounded experiment and merge facts, with no runtime change or newly claimed unverified capability.
- [ ] Check M2 is a bounded real refactor pilot with honest counterfactual and unknown metrics, not an invented productivity claim.
- [ ] Return ACCEPT or actionable findings, with exact commands/results.
Verify with: git diff --stat; git diff; python3 scripts/check_indexes.py; inspect files and native source evidence.
Budget: 8 active minutes maximum; one review pass, one focused follow-up if asked. No delegation. Read-only; no commits or services.
