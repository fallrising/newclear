# Worker result truth in browser

Issue379 bounded AT09 acceptance, baseline760fffab68d4da3cbb779fc5f5743f41ecab0585.
T111 finds no new product defect: backend verifier/result/archive fault paths already
have causal coverage. Existing browser tests use localmock success or synthetic saved
rows and do not establish UI truth for actual Worker failed/unknown/persist-fault runs.
This test-only milestone closes that specific seam, not the full fake fault matrix.

## RTF-01

On one fresh owned PostgreSQL/API cohort, create tasks through production Store command
paths and execute real Worker/runtime-client HTTP against the existing scripted Runtime
double. A failed verification with nonzero check record and an unknown/no-checks result
with an explicit untrusted agent completion claim must remain failed runs, preserve
exact result/archive bytes/hash and show failed or unconfigured verification in the
authenticated browser. A completion claim in summary is not verification authority.
No UI-generated tests-passed label, automatic retry/export or extra worker effects.
Reload/history selection remain bound to the inspected run.

## RTF-02

Inject a scoped persistence exception at the real Worker's persist_archive boundary
for a third run. Observe real transaction rollback/quarantine: interrupted state, no
result/archive/download/export controls, capacity remains held, no runtime release.
Browser must match API/DB without a fabricated successful result. Retain independent
backend fault evidence; this injection is not a new SQL-outage/connector-verifier proof.

## Scope and verification

Only new test helper, dispatch branch and one browser spec plus delivery documentation.
No product/backend/web behavior change, no missing-test RED claim. Do not modify stored
run/result/lifecycle/lease/generation/history to arrange expected outcomes; no triggers
disabled, arbitrary reset, cleanup-proof fabrication or timestamp ageing. Normal bootstrap
fixture task can be completed through its real Worker before owned scenarios.
Bounded private manifest binds boot/DB identity/owned runs and exposes only public fixture
IDs/results. Compare before/after read-only observations and runtime effects. Keep all
resources task-owned and close HTTP double on every path.

Root executes only new browser scenario (three outcomes), strictTS/scopedformat/Ruff,
fresh frontend build/source manifests, project contracts/index/diff and independentreview.
Existing backend/long/native/OC/BGC/expiry suites remain valid and are not replayed locally.
Required hosted CI and normal merge precede scoped delivery. Runtime/model/verification
execution are scripted: no VM/provider/actual profile command execution, complete fake
E2E, liveAT09/12/13, deployment, M4 or usable-tag claim.
