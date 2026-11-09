# PP1c D source checkpoint — 2026-11-09

Desk: T-0351. Source baseline: C merge `cf0aaef6cf584c03a72a00f5d4f53a0c832ec895`. Approved readonly specification: PR1038 / `0529e812171c0fb2dbce9b25edcce21d92e984a4`.

Owner requested saving current progress, committing code and merging the PR. This checkpoint delivers the current implementation and evidence; it does not accept D or reduce its original acceptance criteria. T-0351 and CMS-C-D remain `in_progress`. No new runtime, probe, cleanup, release or deployment is part of this checkpoint.

A/B/C are delivered. D implements restore startup, trusted one-use browser/session/restart checks, persisted proof validation, readonly current-source observation/CLI and separate recovery/account wiring. The new setup-stage markers only identify entry into an operation; they never prove its success. [Evidence](EVIDENCE.md) binds tests and reviews to the exact source versions.

All four actual D attempts failed. D1 failed capture; D2 failed before browser start; D3 exited 7 during browser execution; latest D4 returned `SMOKE_FAILED` / CLI exit 8. D4 journal has successful END through INGRESS_STARTED, then BROWSER_VERIFIED BEGIN and FAIL, with no successful END. Browser root cause remains unknown. Reduced diagnostic probes did not reproduce it. There is no COMPLETE, full proof, locator or released successful workflow. Native passing tests and source review are not actual D acceptance.

Remaining mainline, in dependency order:

1. Resolve the bounded browser blocker using retained failures and fixed safe stage diagnostics, then perform one justified fresh source/target/operation full restore with the fixed annex fixture. Do not add C synthetic load or reuse/unlock a failed target. Check capacity/disk and all approved safety guards first.
2. Only after COMPLETE and original workflow release, run T172 independent actual readback. Then run the genuine default third readonly CLI and prove current source and registry unchanged.
3. Use a new operation and lock for default trueTTY RECOVER; complete full revalidation before ACCOUNT.
4. Complete remaining actual checks, independent acceptance, necessary CI and final D Git/ledger delivery. This source checkpoint does not satisfy those gates.

Retain all private runtime records, original failures, named volumes, locks, TLS/configuration, images and old workspaces, especially `cms-pp1b-resume-20261101`. I2 retirement was separately approved and only D1's exact reviewed resources were retired with preservation receipts; D2/D3 remain untouched. Any future retirement requires the original exact scope, fresh identity/policy/network checks and preservation receipts. No additional retirement is performed here.

The original D worktree remains the private continuation location, including PLAN.md, DELIVERY-GATES.json, final-continuation-state-setup-stage.json, runtime/actual4 evidence and backup receipts. Private records and raw model events are deliberately excluded from Git. All nine new product sources, including four ignored scripts/local files, belong to this checkpoint. Closed worker budgets remain closed; aggregate provider/tool/token/cost accounting is unknown, not inferred from launch counts.
