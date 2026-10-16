# P1c offline bootstrap delivery plan

Root owns this plan, integration and acceptance. Baseline: 6492e4f92916837c519dbeb98764b4fdf5921885. Previous plan archived verbatim in P1B-PLAN.md. Published task claim and exact remote readback are recorded in the protected ledger; no private records are copied here.

## Objective and boundaries

Deliver strict six-node Redis Cluster observations and deterministic, private bootstrap proposals bound to the existing source plan and bundle. Develop-only: no SSH, Redis/Mithril service, remote mutation, reset/flush, automatic repair, purge, release or image publication. Research commit remains 9959fe2e5cd466614dc20ef7b710befaaf1d746a. Full P1 incomplete; MR-004 BLOCKED_ENV.

## Team and model decision

Scenario standard-delivery with contract review before implementation. Root owns shared docs; one Sol builder owns new bootstrap code/tests in an isolated worktree; Astra owns independent design/final review reports in another worktree. Workers do not delegate or commit.

Native collaboration catalog exposes gpt-6.1-sol (builder, high) and gpt-6-astra (reviewer, high). Exact IDs frozen; no fallback. Current official model pages checked 2026-10-17: https://developers.openai.com/api/docs/models/gpt-6.1-sol and https://developers.openai.com/api/docs/models/gpt-6-astra. Model existence/client exposure are observed; provider-resolved telemetry, account quota, tokens and cost remain unknown. Use recent accepted P1b native team experience; no external CLI route, installation or paid discovery probe. Common cli-team source pinned 39fb407d71c7c5aae5f50a9bc01df6b3c215daa3. One bounded slice; reserve independent review capacity, no invented numerical budget.

## Dependency order

1. T-008 Astra design review: exact minimal schema and fail-closed semantics. Root accepts/adjusts contract.
2. T-009 Sol implementation: scripts/bootstrap.py and tests/test_bootstrap.py only, plus own report. Real Red-Green logs; all checks through shared workspace launcher with distinct private task IDs.
3. Root integrates, documents usage/STATUS/VALIDATION, reruns Python 3.11, baseline demo and CLI offline acceptance.
4. T-010 Astra independent final review and adversarial probes. Root resolves findings, reruns affected checks and evidence gate.
5. Source commit with required task trailer; PR/required CI/normal merge; exact remote main readback; ledger review. No task marked done by agent.

## Acceptance gates

- Bound strict inputs, six exact node identities/endpoints, roles, cross-host replicas, full unique slot coverage; reject malformed/duplicate/oversize/unknown/partial/migrating/foreign/drifted observations.
- Distinguish pristine proposal from already-converged evidence and incomplete/unsafe inputs; never turn observations or unkeyed digest into freshness, authorization or runtime PASS.
- Fixed typed plans without shell/credential interpolation, semantic rederivation and independent expected digests, private exclusive outputs and sanitized summaries.
- Python 3.11 stdlib only; retain existing down/lost-reply/cleanup gates. P1a local-fixture remains unchanged.
- Actual Red-Green, root reruns, independent review, required CI, remote readback and honest remaining gaps.

## Decisions and evidence

Planning/claim complete. T-008 design accepted and frozen; integration evidence and review decisions follow.

Root design decision: accept D1–D5 with the precise barrier/unmet constants and
required plan/validate CLI in docs/P1-BOOTSTRAP-CONTRACT.md (p1c-v1). Sol may now
write tests before implementation. Baseline root test run t0320-root-baseline
passed 70 tests; t0320-reading-audit matched 29 required inputs byte-for-byte
to the previously fully read P1b source and validated T-008. Native Sol reading
may overlap Astra report completion; behavioral writes depend on this freeze.

T-009 integrated after full source/test read and hash verification. Final worker
module 7c6b8cbecf0e88c5c603cdb4b17c48f30830297c56921cac7b15aff1b6be5378;
tests 6a191c8060a0b3e8f33c066152f4ed99b906d6baff2d3f996a2817822f8b9593.
Actual Red01 and Red02 retained. Root full01 passed87 on Python3.13.5;
root-cli01 independently passed7 CLI cases. First py311 attempt was denied
Docker socket access before execution; approved py311-02 passed87 on3.11.17
and original8-call/28-operation synthetic demo. No runtime service was started.
Final independent T-010 review and external delivery remain pending.

Root acceptance decision: ACCEPT the bounded offline slice after T-010's
independent87 tests/48 probes, full21-file review and actual evidence audit.
No blocking findings or implementation rework requested. T-010 SHA256
0c314853aab04bf4c6818bf63c6f234c29efe2f8379f702f2e42c96f6628c7d4.
Root static01 passed scope/privacy/links/syntax,3task/2report validators and
unchanged locks/prior tools; final acceptance reruns metadata/static/report
gates after adding T-010 and these evidence-only updates. Code/test/contract
identities remain the independently reviewed ones. Full P1/MR-004 stays open.
Source delivery continues through normal PR/required CI/merge/readback; exact
external outcomes are recorded by GitHub and the protected ledger, not predicted
by this pre-merge source snapshot. No next task is automatically claimed.
