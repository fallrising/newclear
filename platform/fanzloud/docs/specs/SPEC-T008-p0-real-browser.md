---
id: SPEC-T008
title: Real-browser P0 mainline acceptance
status: ready
task: T008
contract_units: [CU-AUTH-P0-01, CU-AUTH-P0-02, CU-AGT-P0-01, CU-CLOUD-P0-01, CU-AGT-P0-02, CU-CLOUD-P0-02, CU-SES-P0-01, CU-API-P0-01, CU-API-P0-02, CU-WEB-P0-01]
failure_atomicity: inherited; acceptance resources are bounded and cleaned
---

# Approved outcome and scope

The owner explicitly resumed private single-operator P0 mainline development on 2026-10-30, tracked by T-0442. This supersedes the old dormant/frontend-only limits for this flow. SUCCESS AC-01 gains actual Chromium evidence; AC-04 still requires live Cloud. Existing accepted frontend and T007 contracts remain unchanged. This acceptance task adds no production authority, dependency, provider version, persistence or retry behavior.

# AC-01: real browser and concrete backend

Given built production control-plane assets/binary, private trusted HTTPS, isolated fake credential/state/working paths validated by CredentialScope, and the existing strict T007 fake executable contract, when Chromium authenticates, confirms login, submits the fixed synthetic prompt once, watches native WebSocket updates and explicitly requests diff, then the page displays the exact final synthetic diff. Refresh/reconnect must not resubmit; logout invalidates the operator session. The fake ledger must contain exactly one exec, bounded status calls and exactly one diff, no unknown or apply operation. All browser HTTP/WS responses originate from the real Rust router through a transparent TLS proxy, never a Node review API fixture. No request interception, WebSocket monkey patch, bypassed TLS validation, or altered CSP/cookie policy.

Use T007's exact fake argv/output and synthetic values. The test may extract the existing shell fixture rather than duplicate its protocol. A fresh bootstrap token stays in memory/private runtime only. No tokens/cookies/auth files/raw request bodies in evidence. Synthetic diff evidence can be an exact comparison boolean; live diff is never persisted. Evidence contains source SHA/dirty-content hashes, binary hash, browser version, request/status counts, WS event coverage, fixed pass/failure stage and cleanup result. A browser run is not proved by unit tests or a fixture response.

# AC-04: same-source live gate

Use the exact same production source as AC-01 with official codex-cli 0.145.0 and all SPEC-T007 live prerequisites. Never substitute the default CLI or broaden accepted parsing. Authenticate in the page, submit one operator-approved low-risk documentation prompt with attempts=1, observe at most ten minutes, read the final diff in the page and logout. Do not apply, push, cancel the provider task, or retry an unknown outcome. An absent prerequisite yields `not run — credential/environment gate unavailable`, separately from AC-01.

Live evidence retains only SPEC-T007 allowed metadata: date, CLI/browser versions, fixed pass/failure stage, source revision. Keep task IDs/URLs, environment/branch, prompts, diff and credentials out of evidence. Authentication and configured target discovery must not print secret values. If an operator decision is missing, first complete the independent fake gate and provide one concrete bounded execution proposal.

# Failure, cleanup and recovery

Bound fake browser execution to five minutes; launch only owned loopback listeners/processes and isolated test storage. Close browser, TLS proxy and Rust process; prove exit and remove only newly-created temporary resources. Preserve sanitized failed-stage evidence. Never kill unrelated processes or reuse an earlier attempt's private credentials. No automatic Cloud retry; existing unknown-outcome semantics remain authoritative. No new archetype operation is introduced; security, atomicity and recovery inherit T002–T007 unchanged.

# Verification and acceptance

Check the harness syntax and meaningful negative verdict cases, then run the concrete browser gate. Run repository-native applicable checks and required CI on final source. Obtain fresh-context document-driven independent review. Record mock/live separately in T008 acceptance, SUCCESS, HANDOFF and task board. P0 success never closes SUCCESS AC-05 or claims a complete platform.
