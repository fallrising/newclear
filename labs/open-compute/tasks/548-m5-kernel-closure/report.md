STATUS: PARTIAL

## Summary

M5-only kernel owner candidate implemented after independently accepted contract
commit00d3881249d24e933c40b8e21806244cf81b75a0 and explicit root release.
New crash_lifecycle owns every subprocess before source identity/preflight,
uses checked subreaper/SIGCHLD and sole registered waits, distinguishes incomplete
liveness from strict target admission, and requires actual ECHILD in addition
to every original per-target root-first SIGKILL/root-9/history/drain guard.
Strict freeze includes the entire live retained/newly admitted union and descends
from retained reparented parents. Immutable identities/deadlines/single-use
capabilities govern restart and normal final0 deletion. M5-only lab routing and
existing integration fixtures use explicit owner APIs; generic/M4/crash helper
implementations remain unchanged.

Current corrected source freeze2 digest:
`d27e1207a388a8d691b0632a46ee896250a8e4d0bf509042cf4ff28ff3f27913`.
Initial source640b was superseded by independently reproduced collector cutoff
and contextual shutdown-schema defects; its351-test proof remains historical.
Independent implementation review accepts the corrected source. One original
M5 qualification and root strict readback pass; hosted CI/merge remain delivery gates.

## Verification

- Author synchronized actual generic observer child_missing causal RED and new-owner missing-module contract RED, preserved as labeled tool-transcript evidence — passed
- Author corrected focused crash tests:57 passed/4.519s on verified Python3.11 SDK with PYTHONPATH absent; exact captured output/exit/source hashes retained privately — passed
- Actual-process controls: sample/strict disappearance contrast, root-first SIGKILL/root-9/ECHILD, reparented parent/new grandchild target union, restart/final0, unknown adopted child, partial signal, stolen wait, policy/launch/drain/target-limit, original expiry/deletion overrun/replay, every new fixture final ECHILD — passed
- Strict local/contextual schema, identity forgery and historical removal/crash/readback projection fallback controls; existing GET-only/no reseed and original deadline regressions — passed
- Static35-input freeze,31 unchanged inputs, lab AST differences integration/main only and git diff --check — passed
- Root prior full frozen gate:351 tests/39.867s on superseded640b source only, all35 old hashes stable, Python3.11.17/PYTHONPATH absent, actual ECHILD and unexpected children empty — passed
- Collector original80ms delayed waitid/waitpid and normal observation_error schema REDs reproduced, then focused GREEN on corrected source — passed
- First57-test rework run: two synthetic shutdown dictionaries omitted real-owner observation_error field; corrected narrowly in the next run — failed
- Root corrected-source full gate:353 tests/40.346s, exactd27e35 input hashes stable, actual ECHILD/unexpected[], Python3.11.17/PYTHONPATH absent — passed
- Independent21 focused cases, actual deadline/retained-union probes and exact narrow source bridge; ACCEPT — passed
- One original M5 qualification26.747s/all5 M5+7 functional controls,2 actual root-first SIGKILL targets/root-9,6 original GET-only readbacks,5+14 direct waits, ECHILD, final root0 and owned removal — passed
- Root strict runtime/source/report readback,17 runtime hashes unchanged and owned container absent — passed
- Required hosted CI and normal merge remain delivery gates — skipped

No author full suite/runtime/CI/Git/publication operation ran. Root full-suite
result is explicitly attributed above; required hosted CI/delivery remain separate.

## Documentation

SUCCESS, SDD-M5 implementation detail, STATUS, quickstart and this report record
the candidate and pending gates. All historical reports, exact CI failure and
original artifact/workload remain intact. Private worker evidence binds exact
commands/output/digests; no private paths, raw logs or state are public artifacts.

## Risks and Follow-ups

Root accepted implementation and original-runtime evidence; full required CI
and delivery remain pending. No mainline-complete, historical-cause, usable-tag, deployment or
release claim. Unknown interruptions before completed validated scope absence
do not claim removed or preserved; independently observed removal survives later
report failure. M4 proof cannot substitute for M5 crash/readback qualification.

Public evidence: [actual M5 report](../../docs/evidence/2026-10-25-m5-kernel-closure.json) and [source binding](../../docs/evidence/2026-10-25-m5-kernel-closure-source.json).
