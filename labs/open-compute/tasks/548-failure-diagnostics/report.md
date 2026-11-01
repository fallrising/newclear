STATUS: PARTIAL

## Summary

Diagnostics-only candidate for #548 is complete and frozen for parent review. **#548 remains partial: current retained-manual runtime failed.** No lifecycle repair, weakened ownership/generation/deadline guard, upstream/pin/fixture/oracle change, commit, staging or GitHub write was made by this worker.

Original base `d8ca3c4089a9fbe852459da3d9602329224230e7`; parent is integrating publication base `71b19d62` and independently confirmed no Open Compute/workflow drift. Runtime receipts pin the original base plus every actual Python/fixture/lock/Makefile hash; they are not a claim that the uncommitted candidate was already published.

Added a separate strict version1 failure artifact and standard-library CI collector. Original, cleanup and evidence failures have independent first-cause slots; existing report shapes and command exits remain unchanged. The process observer records fixed parent/child edge reasons while retaining its exact refusal conditions and message. Strict records reject unknown fields; legacy normal reports deliberately rebuild only known fields and ignore unrelated raw diagnostics. Source identity comes from the checkout rather than an untrusted report field. Inputs/publication are bounded, no-follow/owned/exclusive, with duplicate/nonfinite/deep/oversized JSON and unsafe-file negatives. Best-effort sidecar failure cannot replace the runtime outcome; CI emits a minimal unknown record if evidence is unavailable or invalid. Uploads use explicit paths, retain30days and never include raw logs, argv, secrets, paths, state or backups.

## Verification

All build/test/runtime jobs used the shared launcher. Exact task IDs below identify retained evidence under `projects/issue-sweep/tasks/<task>/preserve/evidence/`.

- T044-red: missing diagnostic CLI/output reproduction, expected failure retained in red.log — passed
- T044-red-boundaries2: parent-directory symlink traversal and forged source identity reproduced as two expected failures; T044-green-boundaries fixed both — passed
- T044-red-exponent: JSON1e999 overflow reproduced as expected failure; finite parse_float guard and T044-green-exponent12tests — passed
- T044-focus-guards:36 focused tests including all seven changed/vanished/reused/reparented edge refusal cases, no adopted child/no signal and strict M7 failure preservation — passed
- T044-final-tests: make check,290tests in27.693seconds, all original276 plus14new, zero errors/skips — passed
- T044-actionlint: digest-verified actionlint1.7.12 on changed workflow — passed
- T044-index:42contracts and5llms indexes — passed
- T044-final-replay: final strict reader/projector consumes all four real reports/sidecars; trial original bootstrap versus later shutdown remains separate — passed
- T044-restore-runtime1: real original artifact, M2 all9gates,44.634seconds, exit0 — passed
- T044-crash-runtime1: real checkpoint SIGKILL, M5 all5gates,29.406seconds, exit0 — passed
- T044-trial-runtime1: first_owner original bootstrap/child_missing, cleanup shutdown,42.277seconds, exit1; M7-01 passed, later gates not_run/M7-05 failed — failed
- T044-storage-runtime1: real original artifact, M4 all5gates,61.713seconds, exit0 — passed
- Final scoped links/index/whitespace/source-manifest checks — passed

Each actual runtime task has `runtime-summary.json`, `source-manifest.json`, private0600 `runtime-private.log`, and `private-runtime/runtime-report/{report.json,failure-diagnostics.json}`. The failed trial's own synthetic home/state is retained under its private-runtime child. All four summaries confirm source unchanged during execution, no watchdog timeout and owned container absent afterward. No actual profile was repeated. The original release is195537392bytes, SHA256 `8829a5bcb334dd3bbd8dc949ad9a2afdfe0e1fef44035c041556cd12087c586f`, verified before execution. No upstream installer/patch/test-only override or provider request occurred.

Runtime used the existing pinned Playwright image `sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`, actual pwuser UID/GID1001 with a fresh owned real passwd home, matching PID/proc namespaces, loopback and no preexisting scope. Containers used init, network=none,2CPUs/4GiB/512PIDs, read-only source/Git metadata, exact new task child mounts only. Root provisioning/restoration changed ownership only on those new children; no source, launcher root/manifest/shared parent or global account/HOME was changed. Parent explicitly approved this interpretation.

Two preliminary invocations never reached upstream: the first could not read a host1000-owned0600 script as pwuser1001; the next passed runtime preflight/artifact checks but the image had no make executable. Both failures are retained (T044-restore1 and T044-restore-run1), not counted as runtime RED/retry. The owned runner then used the exact existing Makefile Python command expansions. Actual profile order was restore→crash→trial→storage, once each.

Final JSON exponent hardening occurred after the four profiles and affects only diagnostic input parsing, not the executed runtime paths or guards. It is distinguished in the final manifest from those runtime manifests. Final290tests and replay of the four actual reports/sidecars exercise this consumer change; no runtime rerun is claimed for the final reader bytes.

## Current failure and minimal causal options

The new sidecar exposed a useful distinction: trial legacy report says first_owner/shutdown; the preserved original failure is bootstrap with observation child_missing, followed separately by cleanup/shutdown. The condition is an outer `Capture(lab.Process)` observer seeing a candidate disappear during the parent-edge sandwich, before admitting it. It cannot prove whether that generation left an unobserved descendant; keeping unknown/refusal is correct under the current contract.

Source narrows the location. Both init responses already completed and M7-01 passed before phase first_owner. `trial_integration.observe_ready` checks the outer Capture's observation_error before decoding a ready message. The outer Capture wraps `trial.py serve`; serve starts an inner daemon Process, then `wait_instance`/`verify_identity` invoke short-lived `ocd instances --json` through `lab.command`. `lab.command` already has its own inner Process ownership, reaping and descendant-cleanup checks. Thus nested observers independently inspect the same descendants, with no ownership-admission/receipt handshake. A short-lived serve-readiness CLI is a concrete hypothesis; **the exact vanished generation/role was not recorded, so it is not established as the cause**. It was not a current init failure.

No pidfd/cgroup/subreaper ownership mechanism was found in first-party code. Minimal follow-up design should first identify the candidate's fixed role/owned launch ID in private numeric evidence, then choose a proof mechanism. A scoped pre-exec admission/ack protocol could hold known helper children until the outer observer has validated/admitted their exact generation, then transfer completion/descendant receipts from the existing inner owner. It needs cancellation, late/forged/reused-generation, exec failure and double-fork/orphan negative tests. Mere pidfd death proves only that process, not all possible descendants. Dedicated delegated cgroup/PID-namespace ownership could provide stronger whole-tree proof but requires a separate contract/environment authority; default containers do not establish such per-command delegation.

Do not simply continue/ignore child_missing, reduce observation frequency, add sleep/retry, assume the command is a leaf, or drop outer descendant checks. Parent requested no lifecycle scope extension now. A targeted hypothesis/design must precede another runtime attempt. The one storage pass does not explain the old M4 parent-edge failure; original mainline incomplete/AC-05 historical failed and usable_tag:none remain.

## Documentation

Contract/SUCCESS preceded implementation. STATUS corrects the expired-log premise and records exact historical source chains: OCR exclusion e8c60d71, child-reap cff9b8cc and retained-instance readiness c4ddd385, with causal limits. Quickstart documents strict record versus projected legacy input, best-effort sidecar failure, CI fallback/allowlist and30day retention. Component task/report and own T044 report contain the process journal.

Coarse-to-fine process: define contract -> missing-feature RED -> strict projection/IO implementation -> adversarial RED/GREEN -> instrument first-cause metadata without changing guards -> preserve original report/exit behavior -> CI projection/retention -> artifact/container preflight -> four one-shot profiles -> report current failure and bounded causal options -> final parser RED/GREEN/replay/static gates -> freeze. Initial generalized fixture writes used default umask and rejected before reaching intended JSON/symlink boundary; tests were corrected to0600 before the retained two-failure RED. All failures remain evidence, not green by retrying.

Final runtime-module SHA256: failure_diagnostics.py `a6bf01498816fbd41b5f638410056663db5293629cfa1658619c79458339dd55`; lab.py `2fc2a85b9628503889fc7ecf25dbc7a1ff0881ce2233681fd5db655f2f8d0495`; trial_integration.py `306d4d8ba0f15eb89618a524dfeb5131955c1278a98a007c83c9031638d51037`. Full scoped hashes are in T044-freeze/preserve/evidence/source-manifest.json. Parent owns staged main integration; worker did not stage/commit/unstage.

## Risks and Follow-ups

This candidate repairs failure-evidence loss, not all548 runtime races. Trial failure remains real, root-cause attribution incomplete, M4 intermittent history unresolved, broader runtime/mainline qualification incomplete. Parent final independent review, exact candidate CI/publication/readback remain pending. No release/deployment/tag, host cleanup or owner acceptance is implied.

Final documentation clarification: SUCCESS labels its 2026-10-21 inventory-only statements as historical; the Issue548 section records the current actual profiles. Final freeze manifest/static checks are in T044-freeze. No further runtime run occurred.
