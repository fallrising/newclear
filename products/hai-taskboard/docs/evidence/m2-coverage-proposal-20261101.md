# Verified coverage proposal review evidence

Task T-0339 / BOARD HM2C. This is contract preparation, **not implementation acceptance**.
Baseline `d3207b3a97a5b223da501af1418e64e94745bf10`; latest HAI change #880. Intake pulled
remote desk/newclear fast-forward, verified the existing in_progress claim and policy handoff, and
listed open PRs: no HAI design/implementation PR. Existing Session/provider proposals remain unaccepted.

## Reviewed scope and decisions

[Proposal](../plans/m2-verified-coverage-20261101.md) fixes route/response, Review prospective and QA
current subject, per-AC verification versus eligibility, material revalidation, error precedence,
bounds and six named acceptance cases. All COV-AC-01..06 are NotRun. No Go/API/runtime/UI/dependency/
migration or accepted SDD text changes in this document-only checkpoint. Product ACs remain pending.
Owner decision is needed on the new contract and explicit V1 Accepted/Fresh vocabulary mapping.

Claude Code2.1.312 requested claude-opus-5-5/high, observed exact model on successful review.
Profile: safe-mode, no tools/MCP/customizations/session persistence, dontAsk; 480s host process-group
limit, no children. Canonical provider card source f36635671c65fc63ba6db5a4741a2c3ff102821f.
This uses the cli-team skill's direct supplied-packet reviewer path, not the inactive dispatcher.
No native worker or delegated writer was started.

## Retained failure and first review

Initial sandbox CLI failed after183.055s, exit1: API DNS EAI_AGAIN, empty modelUsage, no denial.
Do not infer zero provider requests from empty usage. No-model DNS check in the normal escalated
executor succeeded; the same bounded call/profile then ran normally. No setting/auth/provider repair
or bypass was performed. Automatic approval review did not reject either action.

First substantive review:137.257s, exit0, REWORK, no denials/children. Reported input2/output13625,
cache-read649/cache-created30413 tokens; list-price estimateUSD0.5159418, not actual billing.

| Finding | Disposition in revised proposal |
| --- | --- |
| D1 Accepted/Fresh vocabulary conflicts with V1 model | Explicit proposed mapping: admitted semantic Evidence / stored Current; owner must accept before normative amendment |
| D2 Review usefulness | Retain prospective label; evidence_missing is absence, not Failed. Source human_report.go permits Evidence in Review; no automatic verifier implied |
| D3 unexpected artifact I/O | Explicit proposed read503 versus unchanged command unavailable classification; owner decision included |
| B1 bytes skipped by command early return | Reader verifies eligible evidence independently of phase/candidate availability; no covered=true without verified bytes |
| B2 budget outcomes | Deterministic candidate-digest/evidence-ID order, deduplication, bounded attempted payload/objects, over-limit unavailable and continue; command behavior preserved |
| B3 reason merging/parity | Feed byte availability into shared domain input; preserve reason positions. Test eligibility truth and per-check reasons, not command first-error list equality |
| B4 second-snapshot errors | Concurrent Complete/not-found/lifecycle/policy after first success becomes409 stale; corruption/unknown/cancellation separately defined |
| B5 precedence | Explicit full route ladder and cancellation exception; revalidate non-cancellation I/O before503 |
| B6 query scope | SQL already filters exact subject (zero digest gives none). Two-stage same-transaction exact-subject load; >1024 other-subject history oracle |
| B7 typed artifact errors | Proposed ErrArtifactUnavailable plus fs.ErrNotExist, local adapter wraps definite rejection; unknown I/O retained, commands preserve sanitized errors |
| B8 wire consistency | Enumerated boolean/reason/ID/phase/mode/version/cursor invariants |
| C1..8 | Impossible successful-read conflict codes, deterministic actor-bound selection, Review limits, same-transaction cursor, size allowance, metadata corruption, counting ID source and candidate-only failure clarified |

The original packet/review and pre-revision proposal remain retained. The first packet's copied
preparationSubject excerpt was offset incorrectly; substantive network review and follow-up both also
include the actual function. No source or test pass is inferred from review prose.

## Verification scope

`python3 scripts/check_project_success.py`: PASS50 contracts.
`python3 scripts/check_indexes.py`: PASS50 contracts,8 llms indexes,0 errors.
Scoped Markdown link/anchor checker and whitespace checks run again on final proposal before commit.
Runtime backend/web/API local gates are not run for this docs-only checkpoint; unchanged runtime
is not newly accepted. Required repository PR CI still runs and must pass before normal merge.
Claude code review is not run because no code has been implemented; it remains required after approval.
Raw logs, exact packets/results, failure and source hashes are preserved with the task handoff.
Aggregate outer/nested tool counts, provider requests, billing and exact active/wait durations are
unknown/null. Local CLI launches and per-call observed usage are tracked separately.

Final follow-up disposition and delivery receipts are recorded below when observed; no pending gate
is represented as passed.

## Follow-up and root gate

Follow-up186.133s, exit0, ACCEPT **for owner presentation only**, no denials/children. Reported
input2/output19126/cache-read1545/cache-created45281 tokens; list-priceUSD0.745085, not billing.
Claude confirmed all B1–B8/C1–C8 closed, corrected its prior Review-phase assumption, and listed
R1–R7 precision conditions. Root incorporated each in the proposal's final section, including typed
Lstat/Open errors, root-versus-object faults, assembly classifications, reason-set normalization,
stage-2 authority, policy short-circuit and exact lock window. Claude explicitly stated these need
no further plan-review round. Its ACCEPT is on the reviewed proposal plus those stated conditions;
no claim of an extra model review of the final editorial incorporation.

Observed CLI launches3 (one DNS failure, two successful reviews), native agents0. Sum of successful
CLI wall durations323.390s, failed CLI183.055s; reported list-price sumUSD1.2610268. Internal provider
retry/request counts and actual billing remain unknown. Full API/product acceptance is still NotRun.
Root evidence-gate accepts only the reviewed proposal for publication and owner decision.

Final local document gate:50 contracts,8 indexes/0 errors,6 changed Markdown files/187 local
links and anchors, git diff --check all PASS. Proposed-only scope was reviewed directly; no product
acceptance criterion or runtime file changed. Required PR CI and remote delivery follow.
