# 346 — Document offline evidence and live-unverified delivery reports

Issue: https://github.com/fallrising/newclear/issues/346
Component: tools/codex-usage
Private-ledger authorization: orchestrator verified the published doing claim and approved documentation scope; private authorization record retained outside this repository.
Task directory: tools/codex-usage/tasks/346-offline-evidence/

Outcome: Give an evidence-based reporting example separating offline checks from live-unverified behavior without collecting account data.
Why: The phase 1 pilot needs a usable documentation example of the new issue task contract.

## Inputs to read first

- Root AGENTS.md and docs/work-tracking/README.md on this branch.
- tools/codex-usage/README.md and tools/codex-usage/docs/quickstart.md.
- This task and the corresponding GitHub issue; no broad repository scan.

## Scope (may touch)

- tools/codex-usage/README.md
- tools/codex-usage/docs/quickstart.md
- tools/codex-usage/tasks/346-offline-evidence/task.md and report.md

## Out of scope (must not touch)

- Runtime code, workflows, installation, routing, dependencies, credentials, live collection, host connections, and all other paths.
- Workers cannot delegate, commit, or expand scope. No phase 2 or later migration.

## Definition of done

- [x] Both entry documents explain the requested outcome with accurate examples and working links.
- [x] Task/report record actual evidence, limitations and owner acceptance without duplicating GitHub lifecycle.
- [ ] Local native checks, root scope review and independent review pass; hosted CI handled as specified below.
- [ ] A draft PR becomes ready, merges normally and leaves this issue open for owner acceptance.

## Verify with

- Component: `python3 -m unittest discover -s tests -v`; `python3 -m py_compile codex_usage.py`.
- Hosted component CI must pass. Review all added text for public-safe evidence; do not include private paths or authorization details.
- Repo root: `git diff --check`; manual scope, relative-link, Refs and lifecycle review.
- Use the configured shared workspace launcher for checks; preserve logs outside source.

## Budget and stop conditions

Budget: One bounded documentation worker and independent review; at most two rework rounds. Cost and quota unknown.
Checkpoint: 30 minutes or before scope expansion.
Stop when: Owner stops, scope conflicts, authority is missing, or required evidence cannot be obtained.

## Action authority

Commit: orchestrator only, scoped pilot commits
Push: orchestrator only, pilot branch
PR: orchestrator only, draft then ready
Merge: orchestrator only, normal merge after evidence review
Release/deploy: no
Other external writes: orchestrator only, issue metadata and delivery links; no issue acceptance or closure
Authority source: Owner approved the phase 1 proposal on 2026-10-12; existing tracking authorization remains in force. Workers have no external-write authority.

## Decisions and handoff

Owner decisions: Phase 1 only; final issue acceptance remains with owner.
Delivery: https://github.com/fallrising/newclear/pull/347 (opened as draft after initial task scaffold); use Refs #346. Report: [report.md](report.md).
Owner acceptance: Review both documentation changes and the final verification report, then close this issue if accepted. Merge alone is delivery.
