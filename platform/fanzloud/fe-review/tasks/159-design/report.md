STATUS: PARTIAL

## Summary

Drafted issue159's seven-section DESIGN for SDD AC-14. D1 retains the REVIEW
recommendation of static assets plus a limited mock API/WS harness, pending owner
confirmation. AC-15 remains pending; no owner acceptance is inferred.

Base `d8ca3c4089a9fbe852459da3d9602329224230e7`; eight relevant current-main files
at `65a22ac15ec8d334d4c0e7c778b690b1076358de` matched before edits. Current-main
FE directory lacked DESIGN; issue159 was open/assigned with no comments, and no
competing open Fanzloud PR was found.

Corrected stale HTTP/startup assumptions: the native client requires HTTPS/WSS,
production runner configuration cannot be left empty as a fake mode, and the
existing deterministic tests are not a screenshot server. Targets now retain
only an unverified HTTPS candidate with dark/en-US and no production start/env.

## Verification

- Shared-launcher T033-source: eight relevant current-main files equal local base sources — passed
- Shared-launcher T033-docs: `python3 docs/fe-review/check_design.py AC-14` — passed
- Shared-launcher T033-docs: sweep helper `python3 ../check_design_docs.py platform/fanzloud/fe-review`, 29 links and unverified targets — passed
- Shared-launcher T033-docs: targets JSON is dark/en-US/HTTPS, has no start/provider env; whitespace and `git diff --check` — passed

Receipts are under each shared task's `AGENT_EVIDENCE_DIR`. The final T033-final
manifest records the six scoped file hashes, final links/scope checks and report
validation. The sweep helper is an orchestration check outside this repository,
not a new product dependency or installed command.

## Documentation

DESIGN includes source file:line grounding, changes, validation, rollback,
synthetic TLS/HTTP/WS fixtures, explicit-action and secret boundaries, existing
responsive/dark styles, and future normative task/spec prerequisites. Updated
REVIEW/PROMPT/targets and this task/report only; product SUCCESS is unchanged.

## Risks and Follow-ups

Local author work is ready for parent independent review; review, remote CI and
publication remain pending. M1 harness/TLS/browser trust/fixture scripts do not
exist yet, and all runtime/capture commands are explicitly proposed and unrun.
No product code, tests, dependencies, CI, real state, credentials, Cloud runner,
provider or model was used or changed. No commit/staging/GitHub write/delegation.
Do not turn mock results, document merge or historical T007 into a live acceptance.
