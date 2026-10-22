ROLE: WORKER
AGENT: native independent correction reviewer
ID: T-454
Goal: Independently review the documentation-only correction for PR472 deployment-models failure.
Why: Initial full-doc CI39732446852 found three old namespace tokens in component provenance report; initial pre-document deploy pass was not final-doc evidence.
Inputs to read first: systems/ojbquay/deploy/validate-brand.sh; git diff HEAD; root evidence active-repository-coverage.json and docs-final-validation/; existing SDD review. Base commit6718e5bedb96f85fca414396901680c73b0e462e.
Scope (may touch): .team/reports/T-0368-ojbquay-sdd-ci-review.md only; all other files read-only. No runtime or container run, no network, Git mutations, recursive delegation or model services.
Out of scope (must not touch): Source/test/CI/validators, original repair worktree, other docs and tasks, .team/PLAN.md.
Definition of done:
- [ ] Verify no validator weakening, source/test changes, or retry/AC semantic changes; exact old-name query retained in root evidence with honest classification.
- [ ] Verify original CI failure preserved and pre-document local PASS not claimed final-doc PASS; inspect corrected deployment/contract result when available.
- [ ] Return ACCEPT/REWORK for docs-only correction, no product/SDD-owner acceptance claim; report exact hashes/checks.
Verify with: git diff HEAD --check; actual diff and evidence; teamctl report validator. Report STATUS and Summary/Verification/Documentation/Risks and Follow-ups; verification entries exactly end — passed|failed|skipped.
Budget: 10 minutes, one inspection plus at most one evidence refresh; no recursion.
