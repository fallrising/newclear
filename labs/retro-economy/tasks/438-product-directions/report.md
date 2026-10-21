# 438 — Product-direction design report

## Summary

Added proposed, unimplemented lab designs for an original economy-driven retro RPG and a bounded numerical-programming learning experiment. Existing Kith reading/capture planning and OpenMMO/Zircon research retain their scope; no competing knowledge product, execution platform or imported game implementation is added.

Root navigation lists both labs as ungraded. Agent Workforce's stale SDD-only root summary is corrected against its existing component documentation; this change does not rerun or extend that runtime.

## Verification

- Changed-document path/privacy checks: passed, 136 local links and zero errors. External URL availability and Markdown anchors are outside this path check.
- `python3 .github/scripts/validate_llms_txt.py`: passed, 5 files and zero errors.
- `git diff --check` against the pinned base: passed.
- Independent source/document review: passed, no blocking findings across gameplay, accounting, numerical scope, navigation and public content boundaries.
- Root ran the required document checks through the shared workspace launcher. A source fetch during authorship stalled and was interrupted; the reviewer independently inspected the official source and root completed the transferred checks. The interrupted fetch is not claimed as successful.

Product tests and benchmarks are not required for this documentation-only change and were not run. No dependency installation, game server, model inference, deployment or asset import occurred.

## Documentation

- [Retro Economy README](../../README.md) and [SDD](../../docs/SDD.md).
- [Handwired Learning README](../../../handwired-learning/README.md) and [SDD](../../../handwired-learning/docs/SDD.md).
- Root README and llms.txt provide discovery; PORTFOLIO investment decisions are unchanged.
- Refs #438. Design delivery does not imply owner acceptance, implementation approval or issue closure.

## Risks and Follow-ups

The economy design needs two distinct forms of evidence: transaction correctness and real players finding the choices worth repeating. Simulated transactions cannot establish human demand or MMO-scale operation. The learning design needs pinned source review, numerical/gradient checks and a small controlled demonstration before any usefulness or performance claim. Both projects remain documents only.

## MVP revision — 2026-10-22

- Retro Economy SDD cut to a two-profession listing/buy slice on a single-threaded stdlib server with four SQLite tables; escrow, commissions, quality tiers, expiry, migrations and economy simulation are listed as deferred.
- Handwired SDD now starts with an upstream API check: the pinned docs confirm the `Circuit` builder and CPU evaluator but do not document a callable gradient API. If none exists, the page uses analytic gradients and says so. Holdout, finite differences and evidence export are deferred. Learning rate 0.05 on nine fixed points was checked on paper to converge within 500 steps and 2.0 to diverge; it has not been run.
- Kith reading/capture plan cut to one private deployment: mobile capture, inbox, reading page and human notes, with one-way D1 → Git export and acceptance cases RC-01 to RC-07. Public deployment, Telegram/Slack, analytics and read-version diff are deferred.
- Verification: `git diff --check` passed; relative links in the changed documents resolve. No product tests were run; these remain design documents.
