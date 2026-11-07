# T-0426 Bounded official Claude client pilot

Demand: [desk T-0426](https://github.com/fallrising/desk/tree/main/tasks/T-0426-thinrouter-mainline-acceptance), R-04 / core AC04 and AC10–14. Claim [PR344](https://github.com/fallrising/desk/pull/344) merged `fc9313f1f0c29c90c5ddb5eeff7d00ce20246a28` before implementation. Current source `67267591808e83ad72914d3c594ace4fcb32244e`; relevant runtime matches the previously verified recovery baseline.

Owner approved Claude tools and Cursor text-only, an individually owned subscription profile, official CLI use/normal refresh, a fixed model and subscription-only billing. No credential extraction/copy, API billing, account/provider fallback, Docker, new dependencies or host permission changes. Profile identity remains private. Selected model is `claude-opus-5-5`, actual CLI2.1.312; official minimum2.1.280. Exact binary identity and commands remain in private evidence.

## Fixed scope and acceptance

- LP-1: Before inference, establish named client/provider versions and selected-mode request behavior using a synthetic profile in a network namespace with no external interfaces or real profile mounts. No required safety-field loss, loaders, permission bypass or model substitution. Source strings alone do not prove emission.
- LP-2: If preflight and admission/cleanup checks pass, at most six gateway inference admissions, total10minutes and each request60seconds: text1, tool request/result2, next turn1, restart/resume1, cancel1. Gate failures stop execution with cases unexecuted; no extra retries to obtain a pass. Internal CLI calls and remote cancellation effects may remain unknown; no monetary/token hard cap.
- LP-3: Preserve actual outcomes, source/model/version/evidence layers, usage scope, cleanup and remaining gates. Independent review, applicable repository checks/CI, normal merge/readback, private ledger, backup and owned cleanup complete this bounded attempt. Unexecuted cases and whole-product acceptance remain incomplete.

## Design before execution

Genuine downstream Claude Code uses a synthetic profile and owned loopback admission endpoint. Upstream official CLI uses only the authorized profile, with isolated gateway database/workdir. Exact model and required safety metadata must survive. One Read tool may access only an owned synthetic fixture. No permission skipping, system-prompt replacement, preload, entrypoint spoofing or quota workaround.

Source-level safeguards uncertainty needs selected-version evidence. If required fields would be dropped, stop before live; never suppress them to advance. Explicit model pin alone does not prevent official content-based fallback. Validate supported exact-model allowlisting/refusal settings; preserve classifiers and omit Agent/subagent work. Do not modify global or managed settings. Auth/version checks alone are not live model availability.

Estimate30–45minutes,20minute checkpoints, one initial diagnosis plus one justified correction per issue. Existing bwrap provides isolation; sandbox NETLINK_ROUTE denial was separated from a successful harmless platform-approved namespace check. No new dependency. Run meaningful focused checks and repository-native document validation; no fabricated runtime RED. Complete delivery then stop, without a new milestone.

## Observed results

The bounded live attempt ran on2026-10-31 with six gateway admissions, five finalized successful rows and one finalized cancelled row with partial usage. Every admission completed locally within3.659seconds; the complete attempt was well under10minutes. No extra live retry or account/provider/model switch was requested. Internal model requests and actual billing were not measured; client cost fields are estimates, not an invoice.

| Gate / case | Observed result | Limit |
| --- | --- | --- |
| LP-1 isolated genuine CLI / model restrictions | Selected ordinary-mode capture carried no safeguards; blocked-model negative control resolved only to the permitted model. Namespace has only loopback and no real profile. Atomic six-admission and failure/deadline rejection checks passed. | This does not certify other modes, versions or all safety fields; required unsupported fields stop before forwarding. |
| Text / tool / next turn | Real text stream returned the exact marker; actual Read call and result IDs/path/content matched the owned fixture; next turn reproduced it. Admissions1+2+1. | One selected client/provider/version/model; not the whole client matrix. |
| Gateway restart | Existing usage rows remained equal and another real request preserved conversation content. Admission1. | **Native session reuse did not pass:** all six upstream dispatches started distinct CLI processes, none with `--resume`. Context continuation is not same-process or native resume evidence. Cause remains unknown. |
| Cancel / usage / cleanup | Cancel after a stream event; sixth usage row is cancelled/partial, other five succeeded/complete. All six finalized, owned child leaders reaped and process groups empty. | Remote generation after cancellation and provider-internal retry/counts are unknown. |

LP-1 passed for the selected mode. LP-2 is partial: the bounded journey was executed, but original live same-process/native-resume expectations remain open under AC12–14. LP-3 publication/ledger/backup gates are recorded separately; no full-product acceptance, release or usable tag.

Preflight failures are retained: the fake400 capture caused six CLI requests; an initial synthetic tool service incorrectly assumed the last message was user, while the actual CLI appends system messages. Two diagnostic attempts and their errors remain recorded; corrected last-user selection passed text1+Read2. These were harness issues, not product REDs. Independent review found and verified corrections to both safety-field rejection, timer placement before send, process-group cleanup and exact result assertions. No runtime source, Cargo dependency or product permission change.

Next eligible work is bounded **offline diagnosis** of the six-spawn/no-resume observation against existing signature/history/session contracts. The present six-request authorization is exhausted; no additional live run is implicit. Do not infer a fix from green fixture history or change reuse criteria to make this result pass. The original17AC and mainline incomplete/usable_tag none remain unchanged.
