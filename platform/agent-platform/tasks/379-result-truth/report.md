# RTF01/02 local acceptance snapshot

Baseline PR659 merge760fffab68d4da3cbb779fc5f5743f41ecab0585. Priorcontract043bb29c
and reviewed live-observation amendment e79c43e5 precede implementation.
No product defect was established; this is test-only AT09 browser qualification.
No new product RED is claimed. T114-browser1 passed one new scenario with three
Worker outcomes in4.0s. Source-before/after equal; owned helper exited cleanly and
PostgreSQL test container removed. No runtime retry was needed.

## Actual verification

From the component source, shared workspace launcher issue-sweep taskT114-browser1
ran the source-bound T114-private-run.py/T114-web-run.py chain (absolute local evidence
paths abbreviated). In its read-only source/task-owned mirror it ran:

- Ruff check and format --check for browser-fixture.py and new browser_result_truth_fixture.py.
- tsc --noEmit and Prettier --check e2e/result-truth.spec.ts.
- Vite build:68modules/228ms; unchanged product assets rebuilt from this source.
- test-postgres.py wrapping Playwright test e2e/result-truth.spec.ts:1passed4.0s.

All above passed. Helper1b7a586ac236b3ac63ca618e63a14fd4bf1c0e80fdde51c8b83f7637e1a9a83c,
dispatch2d892ff382d46eaa55327a15c058301122d6af1afe29988f12dae0085b47ecda,
spec75ef42462c9044331ca88627c3e0e44aa473fa64a907225c32a1e9fc440a8ed4.
FreshJS3c4d6ce29d3775e6b31c4ed1728dab7fc0a777da767323f1b737145d9f667eac
matches unchanged product source. Logs/source/asset manifests and private fixture facts
retained. Independent source prereview found a close-ACK timeout and unawaited kill
fallback; fixed and previous spec preserved before runtime. No runtime failure hidden.
Final independent evidence review, project contracts/index/diff, necessary hosted CI
and normal merge remain delivery gates.

Three outcomes use production Store/Worker/DB/API with scripted runtime HTTP, not
manual lifecycle SQL. Failed and unknown/no-checks results remain inspectable with
exact archives; an untrusted completion claim never substitutes for verification.
Scoped persist_archive exception must leave interrupted/nullresult/noarchive and
heldcapacity with no release. This is not a new SQLoutage or verifier-execution proof.
An owned child holds Runtime through browser observations, with bounded read-only
observe/close protocol and finallycleanup. No arbitrary reset/time rewriting/trigger
bypass, extra worker/exports or liveVM/provider calls.

Existing backend/long/native/OC/BGC/expiry tests are not repeated locally. Fullfake
faultmatrix/liveAT09/12/13/VMrecovery/deployment/M4 remain open; no usable tag.
