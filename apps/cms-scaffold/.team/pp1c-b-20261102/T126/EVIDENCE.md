# T126 evidence

Approved input: PR975 merge `33a5498fbfa5f1a9f7d055bde07459bde62ada84`, exact remote readback confirmed by root before dispatch. Read task, component AGENTS, formal annex §1 and wave amendment, DECISION/BLOCKER/PROBE, root B PLAN, prior T123 hashes/report, worker/evidence skills.

## Scope and contract mapping

Only four permitted source/test files changed. `buildHelperPolicy` validates the fresh image's exact PGDATA declaration before create. Other image declarations require `{}` values and destinations already explicitly present in that role's original policy mounts; no /tmp or arbitrary destination exemption. Fixed additional PGDATA tmpfs is derived from the two PG client kinds or the two explicit PG version kinds, without new policy preimage keys. PG version policy is created only from the workflow context's pinned PG image, direct fixed executable and exact `--version` args; private expected.pgProfileImageId independently supplies that image to create/inspect validation. No new caller option or public API export.

Create argv preserves the original /tmp argument and places the exact read-only 1 MiB PGDATA mask immediately after it. All create/running/exited inspections use the same exact Tmpfs comparison. Original mount count/type/source/read-only checks remain unchanged, rejecting anonymous persistent volumes. Existing lifecycle absence checks remain intact.

## Named Red and historical failures

- `red-native.log`: initial test fixture edit had a syntax error (extra closing brace); not accepted as behavioral Red. Retained unchanged. Corrected once before production edits.
- `red-corrected-native.log`: import-safe named Red, 12 tests / 8 expected failures / 4 existing rejection passes. Failures expose missing PG_DUMP/PG_RESTORE mask, missing-mask acceptance, missing/extra/wrong image declarations, and non-PG declaration acceptance. Existing rejection of writable/oversized/extra tmpfs and anonymous mounts remained green.
- `nonPG-listed-red.log`: named contract-fidelity Red exposes over-restrictive rejection of declarations already covered by explicit mounts. Root confirmed the literal contract interpretation, then implementation permits only those exact `{}` declarations.

## Green commands and exact outcomes

Native Node child runner was executed outside the sandbox restriction previously diagnosed in T123; every Docker interaction in these tests is synthetic. No actual Docker or network command was executed by this worker.

1. `node --test scripts/local/maintenance-helper.test.mjs scripts/local/maintenance-helper-integration.test.mjs scripts/local/maintenance-workflow.test.mjs`: `green-native.log`, 112/112 pass; initial implementation.
2. Same command: `final-green-native.log`, 117/117 pass; added profile role/image/executable/argv and before-create declaration tests.
3. `node --test scripts/local/maintenance-helper.test.mjs scripts/local/maintenance-helper-integration.test.mjs scripts/local/maintenance-workflow.test.mjs scripts/local/maintenance-helper-session.test.mjs`: `frozen-green-native.log`, 157/157 pass, 0 failures/cancelled/skipped, 13628.443284 ms; final contract-aligned source.

Named coverage includes fixed PG_DUMP/PG_RESTORE masks and unchanged policy keys; created/running/exited positive inspection; missing/writable/oversized/extra tmpfs and anonymous-mount rejection; exact image declaration rejection; non-PG mask misuse; version-role verified image/executable/exact argv and network binding; non-PG profile exclusion; declaration failures before Docker create; allowed existing-mount-only declarations. Prior real-token/helper drain/cleanup regressions also pass in final workflow/session suites.

## Checkpoint and boundary

`checkpoint.json` and each `.before`/`.after`/`.diff` preserve the reviewable change: 134 handwritten added+removed lines including tests (helper 43, helper tests 57, profile tests 28, workflow fixture 6), below 400. `final-source-hashes.json` binds the exact four source files. Source frozen at 12:35:59Z, 367 wall seconds after the first measured 12:29:52Z start; active time estimated about 6 minutes of the new 30-minute amendment allowance. Prior T123 estimate remains 48/75 minutes, not reset. Task/report validators and git diff --check are separately recorded in validation.log; explicit trailing-whitespace scan covered all four files including ignored/new paths.

Root owns actual same-image profile/capture, combined gates, independent review and publication. No runtime, Git mutation, network, dependency, permissions expansion, formal contract edit, C/D work or delegation occurred. Aggregate provider/token/cost counts remain unknown; no additional provider route or agent was launched.

## Follow-up: inactive Docker network lifecycle

Root observed actual CREATED INVENTORY with exact HostConfig.NetworkMode full ID and the planned network name, but NetworkID/IPAddress/EndpointID blank until activation. Root and T127 confirmed existing PR956 endpoint semantics cover this; no new product decision. Root explicitly added maintenance-workflow.mjs to scope only for independent registration binding of expected.dataNetworkName to source.project + `_data`.

Named Red `network-lifecycle/red-native.log`: real registry/token blank CREATED→RUNNING→blank EXITED fails before implementation; seven existing malformed cases reject. After implementation, the complete helper/profile/workflow/session command above passed 177/177, zero failures/cancelled/skipped, 16654.250284 ms (`network-lifecycle/green-native.log`). CREATED/EXITED require exact planned HostConfig ID and independently bound name; NetworkID is blank or the pinned ID, all endpoint/IP/gateway/MAC string fields are empty, prefix lengths are zero. RUNNING still requires the full pinned ID and now explicitly RFC1918 IPv4. Persisted historical endpoint is retained after EXITED. No target inspector or unrelated product file changed.

Registry regressions reject wrong/forged network names, changed HostConfig, unknown nonempty NetworkID, unexpected IP/endpoint, extra network, and each nonempty exited endpoint field. Helper regressions reject public/loopback/IPv6 running addresses. Wrapper fixtures now accurately model blank inactive fields. `network-lifecycle/checkpoint.json` records 75 changed lines including tests, all before/after snapshots, and updated hashes. The final T126 manifest now contains five files including the approved workflow registration line; prior four-file manifest is preserved. Follow-up measured start12:40:33Z, freeze12:43:06Z; cumulative amendment active time approximately10/30minutes, priorT12348/75 unchanged. Root owns actual runtime retry; no runtime or old-resource operation by worker.

## Follow-up: exact Docker top header with horizontal padding

Root task amendment authorized only helper.mjs and workflow.test.mjs after real capture6 observed the fixed pg_dump process/backend but rejected Docker's actual `PID                 COMMAND` header. Root retained `approved-pg/docker-top-header.json`; worker performed no Docker/runtime command. Estimate25–45 lines before writing; actual22 added+removed lines including tests, below80/400.

`top-header/red-native.log`: actual-shaped padded and tabbed headers both fail through the real registry/token PG wrapper, while six malformed-header/process cases already reject. `top-header/leading-newline-red.log`: old whole-output trim incorrectly accepts a missing initial header line; named negative fails with Missing expected rejection. Production parsing now preserves the first line with trimEnd and accepts only anchored `[ \t]*PID[ \t]+COMMAND[ \t]*`; single-process/exact argv validation remains unchanged.

Green command `node --test scripts/local/maintenance-workflow.test.mjs scripts/local/maintenance-helper-session.test.mjs`: `top-header/green-native.log`,105/105pass, zero failures/cancelled/skipped,18858.292209ms. Wrapper coverage includes observed padding/tabs, unknown/extra/missing/newline/leading-empty header rejection, extra process rejection and wrong argv rejection. Native Node escalation uses synthetic command/pipe adapters only.

`top-header/checkpoint.json` preserves before/after/diffs, prior source manifest and updated hashes. Final T126 manifest still contains five files; only helper.mjs and workflow.test.mjs changed in this follow-up. Source frozen13:32:57Z, measured follow-up149wall seconds from13:30:28Z. Cumulative active estimate13minutes before final reporting of the original30minute amendment budget; no reset of T126/T123/T128. Whitespace and task/report validation passed. Root owns actual fresh capture and final acceptance.

## Follow-up: independently bound Docker none network identity

Root/T127 confirmed this is existing network=none semantics, not a new owner decision. Root's actual running probe has full Docker none NetworkID and internal64hex EndpointID with all routable fields empty; exited EndpointID clears. Read-only diagnosis tied capture7 rejection to the old blanket EndpointID prohibition before MEDIA_PACK consumer startup. Root explicitly authorized the five existing helper/profile/workflow files before implementation. No actual runtime operation by worker.

Estimate120–180 changed lines before writing; actual93 added+removed lines including tests, below400 (`none-network/checkpoint.json`). Private expected.noneNetworkId now comes from fresh Docker network inspect none: exactly one record, full64hex Id, Name none, Driver string null, Scope local. The registry independently repeats that observation and rejects caller-forged expected identity. Profile probes also inspect before every create. These are private expected fields; policy hash key set and LeaseV2 shape remain unchanged.

Container validation requires HostConfig none and exactly one Networks.none entry; running NetworkID matches the independent pin, EndpointID is internal full64hex; created/exited endpoint is empty and NetworkID is empty or pinned. IPv4/IPv6 address/gateway/MAC fields are empty and prefix lengths zero. Lease logical endpoint remains null in every state. Existing host/bridge/extra-network, full-ID, process and exact policy checks remain.

Named `none-network/red-native.log` exposes rejection of actual-shaped running metadata through real registry/token before implementation. First focused Green148/148; expanded final command `node --test scripts/local/maintenance-helper.test.mjs scripts/local/maintenance-helper-integration.test.mjs scripts/local/maintenance-workflow.test.mjs` passes167/167, zero failures/cancelled/skipped,19514.254005ms in `final-green-native.log`. Negatives cover forged/mismatched network ID, name/driver/scope, extra/host network, routable address/gateway/MAC/prefix, malformed running EndpointID and nonempty inactive EndpointID; profile wrong-driver rejection occurs before create. The positive real registry test verifies null logical endpoint after RUNNING and EXITED; existing wrapper MEDIA path uses actual-shaped lifecycle metadata.

All before/after/diffs and prior hashes are preserved in none-network; final T126 five-file manifest refreshed. Explicit whitespace scan and git diff --check passed. Source frozen13:47:53Z,196 measured wall seconds after13:44:37Z. Cumulative active estimate21minutes before final reporting of original30minute budget; previous budgets not reset. Root owns actual capture and independent final acceptance. Worker performed no Docker/runtime, Java, Git, formal contract edits or delegation.
