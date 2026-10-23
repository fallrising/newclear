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

The complete canonical command is `PYTHONPATH=scripts:tests python3 -m unittest
discover -s tests -v`, run through the shared launcher with private umask 0077 and
local socket fixture permissions. Its completion receipt is pending. Exploratory
failures and targeted repairs are preserved in the worker evidence; they are not a
substitute for the frozen full-suite gate. Frozen scripts/tests SHA256:
`7c71a2aaec71a873e82f5891967e1345c7df01af64dea2cc1522efe88a9da85e`.

## Documentation

[Operator inventory](../../docs/OPERATOR-INVENTORY.md) defines the private input,
new explicit CLI arguments, filename compatibility and re-review behavior. README
links the current configuration entry. Existing historical deployment reports remain
unchanged.

## Risks and Follow-ups

Full synthetic discovery must finish successfully before final maintenance acceptance.
No real private inventory, credentials, host/provider/SSH, deployment or destructive
operations were used. Mainline remains incomplete; AC-04/05 live acceptance and usable
tag requirements remain unchanged. Parent owns publication and final acceptance.
