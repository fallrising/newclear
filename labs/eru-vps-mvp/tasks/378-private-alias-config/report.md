STATUS: PARTIAL

## Summary

Issue 378 now uses explicit private inventory for SSH aliases across operator,
recovery/reimage/fresh planning, copied-source transports, collectors and smoke
reapply. Logical node IDs, roles and existing authorization/hash/generation/exact-target
checks are retained. No ambient override or deployment-specific alias default remains
in runtime/tests. Neutral fixture conversion is mechanical; configuration validation,
explicit propagation and generated-bundle closure are the behavior changes.

## Verification

- Original implementation rejects two positive injected-inventory regressions; expected RED reproduced without host operations — passed
- Inventory six and CLI five synthetic regressions, existing targeted recovery/reimage/fresh/drain/loss/soak suites — passed
- Bootstrap/replay/firewall clean isolated-interpreter tests reproduce missing-helper RED and pass with fixed bundles — passed
- Independent review: 16 focused and 52 guard regressions; frozen 229-file source hashes unchanged — passed
- Repository `python3 scripts/check_indexes.py`: 42 project contracts, five llms indexes, zero errors; `git diff --check` — passed

The canonical command `PYTHONPATH=scripts:tests python3 -m unittest discover -s
tests -v` completed through launcher task `T016-frozen-full`: 1299 tests in
12451.298 seconds, one ERROR, no failures. Its wrapper recorded 12452.08 seconds
and unchanged 229-file candidate hashes. The error was the new inventory loader
rejecting the historical trusted project `private/` root symlink. The original
receipt remains failed and is not converted into a full-suite pass.

T-057 reproduced that exact error, then restored only the project loader's trusted
private-directory boundary. Explicit-file loading still rejects every symlink;
the project path/ancestors and the inventory file below the trusted root also
remain protected. The prior negative root-link inventory assertion now exercises
the strict explicit-file API, matching its intended boundary. The historical
rebuild test and all its immutable-record assertions are unchanged.

Launcher task `T057-frozen-guards` passes 54 tests in 2.483 seconds across
`test_operator_inventory`, `test_fresh_rebuild`, `test_operator_entrypoints`,
`test_fresh_bootstrap_ssh`, `test_fresh_replay_ssh` and
`test_fresh_network_firewall_ssh`. All 229 revised hashes match before and after.
Only `scripts/operator_inventory.py` and `tests/test_operator_inventory.py` differ
from the original frozen candidate. New manifest digest (canonical JSON encoding
recorded in the manifest):
`737ceb84ea1a8a295277fa362b4b5e099cb45aa2d6db78ab49099cae1573d43f`.
The original manifest digest remains
`7c71a2aaec71a873e82f5891967e1345c7df01af64dea2cc1522efe88a9da85e`.
An initial focused invocation named a nonexistent bundle-test module; that harness
error is retained separately in `T057-focused-green`, followed by the corrected
54-test passes. Repository contracts remain 42/42 and five indexes with zero errors.

## Documentation

[Operator inventory](../../docs/OPERATOR-INVENTORY.md) defines the private input,
new explicit CLI arguments, filename compatibility and re-review behavior. README
links the current configuration entry. Existing historical deployment reports remain
unchanged.

## Risks and Follow-ups

The completed full synthetic discovery has one error on the previous candidate.
The narrow repair has focused evidence; parent owns the impact decision, independent
review, further broad verification and final maintenance acceptance. No second
full discovery was run by T-057.
No real private inventory, credentials, host/provider/SSH, deployment or destructive
operations were used. Mainline remains incomplete; AC-04/05 live acceptance and usable
tag requirements remain unchanged. Parent owns publication and final acceptance.


### 2026-10-24 owner deferral

Independent T061 review accepted the bounded trusted-private-root correction:
54 focused tests passed in2.607s, all229 revised hashes unchanged. The prior long
completion integration passed on the earlier candidate and its ordinary-directory
inputs are unaffected; this does not convert the original1299/oneERROR suite into
a fresh full pass.

The parent broad regression was interrupted at the owner's explicit request to
move long verification to a future disposable VPS follow-up. The stopped run is
incomplete, not a pass. Preserved evidence includes its streamed log, unchanged
source hashes and identity-verified SIGINT/zero-remaining-process receipt.
PR572 remains Draft; no merge or new long local run until the deferred validation
is completed and reviewed. No VPS has been selected, provisioned or accessed.
