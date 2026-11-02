# T136 fixed backup CLI evidence

Base667e5ccd; start approximately2026-11-02T15:37Z; final source frozen2026-11-02T15:47:15.950795Z. Root approved signatures, <400estimate, TARGET_NOT_OWNED/7 when both strict inspections fail, fixed component cwd and verified Node24/digest before implementation/capture. This is a bounded correction to already-approved §4.2d, not a new policy.

Exact commands:
- `/home/ckc/.local/bin/node --test --test-name-pattern=PP1c_backup_native_CLI_malformed_input_is_not_silent_success scripts/ops/local-bundle.test.mjs`: initial sandbox test-process failure before behavioral output, retained red-native.log; unrestricted authorized native child run red-native-unrestricted.log proves actual exit0 versus expected2.
- `/home/ckc/.local/bin/node --test scripts/ops/local-bundle.test.mjs`: first green-native.log had41passes/1failure from the import-test child-eval newline escaping fixture; production CLI/native malformed tests already passed. Original fixture retained test-before-import-fixture-correction.mjs.
- Same focused command after test-only escaping correction and final Node/cwd/default-capture coverage: green-corrected.log45/45passed,0failed/cancelled/skipped,3758.556872ms.
- `python3 /home/ckc/test/codex/agents/codex-team-superpowers/scripts/teamctl.py validate-task .team/tasks/T-136.md`: pass.
- `git diff --check`: pass.

Checkpoint176handwritten added+removed lines includes57module/imports and119tests. Both before/after snapshots, complete diffs and SHA256manifest are retained. A direct text comparison proves all capture implementation from const ensure through captureLocal remains byte-identical; only imports and appended CLI changed. Node v24.18.0 actual binary used.

Tests include invalid/missing/duplicate/unknown/extra/override flags before inspection/mutation; canonical five-key receipts and no raw canaries/stderr; import safety; unavailable source; exact component cwd; major24 and binaryhash requirement; strict running then stopped inspection; no capture for mismatched identity; fixed BACKUP_LOCAL/RESTORE_ORIGINAL/nulltarget/nullincident; known OpsError phase/exit preservation and sanitized unknown failure. Trusted injected helpers exercise the actual default captureLocal composition and its private complete marker, not a fake runtime claim. Native children perform no Docker operation because invalid input/cwd/version or absent private run fails first.

Root owns combined tests, independent review, actual CLI smoke, CI/merge/readback and propagation into C. Worker did not touch Docker/network/old runtime/source outside two allowed files, dependencies, Git mutation or other worktrees. New30active-minute task used approximately12minutes including report; prior B/C budgets notreset, exact provider/tool/token/cost/active-wait aggregate unknown/null.

Root evidence gate —2026-11-02T16:04Z: T137 independent source review DONE, inspected against actual diff/logs. Complete Node command `timeout900 /home/ckc/.local/bin/node --test scripts/local/*.test.mjs scripts/ops/*.test.mjs` passed537/537,0fail/cancel/skip,29131.712979ms (combined-node.log). Actual fixed CLI command and independently checked artifacts are in actual-cli.json/run-actual-cli.py: operation612c5a44-a718-41c8-9a23-23fe60e501c0, exit0, empty stderr, canonical COMPLETE receipt, manifest0c57ae52dfeb9b0f102a53b746f50d1b0554ab12f03468b006efefea4fc6f029, dump77263980/inventory135522998/media44bytes. Threehashes/private0600/nlink1, COMPLETE journal, lockrelease, oldbundleimmutability and originalAPIcontinuouslystopped checked. Only ownedPG/ingress started and finally stopped, all data/runtime/locks retained. This positive is actual native CLI/defaultinspect/defaultcapture, no injected consumer. Media remains empty; no restore proof. Source checkpoint176unchanged. Java/FE source unchanged, prior B gates retained and currentPRCI stillrequired. Native task/report/whitespace/projectcontract validation follows below; publicationpending, no C/D completion.

Initial staged whitespace check rejected a context-only blank line in generated local-bundle.test.mjs.diff. Raw original retained locally; exact bytes published losslessly as .diff.encoded.json with SHA256, no source/test/log alteration. Corrected staged whitespace and native project checks must pass before commit.

Final local project contracts checker passed1project; both task and both report validators passed; corrected staged whitespace passed. Aggregate tool/provider/token/cost/active-wait unknown/null.

Publication packaging: five ignored raw test logs are preserved locally and published losslessly as .log.encoded.json with index log-encoding.json; no failure or skip removed. Native `python3 -m unittest discover -s scripts/tests -p test_project_success.py` passed15/15.
