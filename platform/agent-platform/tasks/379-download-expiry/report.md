# DUX01/02 local delivery snapshot

Baseline PR658 merge d81a7d91415d4e4733a58c61fa9b72f32412b1e0. Priorcontract
b3b9ab2d and guard-safe fixture amendment14138d5d precede implementation.
Root actual RED ran15 rendered-App cases:11behavior failures/4passes in15.14s
on unchanged product; original log/test/source manifests retained. T109 independently
accepted RED. No import/environment failure or first-green claim.

## Local verification

- T110-unit1: strict TypeScript and scoped Prettier; 15 new DownloadExpiry and18
  existing ExportExpiry cases passed, plus5 affected App archive cases.39 unrelated
  App cases intentionally unselected. Total38distinctfocusedPASS; unchanged frozen
  testf4e3510c from RED throughGREEN.
- T110-browser1: fresh Vite build68modules/94ms; one actual Chromium/API/SQL/archiveGC
  scenario passed3.5s, owned PostgreSQL removed; exact sourcebeforeafter equal.
  Download410 is actualAPI; only subsequent browser metadata GET is deliberately
  aborted, then explicit retry uses real API and confirms persistent tombstone.
- Two test-helper Python files pass scoped Ruff/lint/format. No oldlocal Python/native,
  BGC, OC or unrelated browser replay. Required hosted CI is a separate gate.
- Final independent review/project contracts/index/diff/normalCI/merge remain gates.

ProductAppSHA75d079858cd0e21a54f9a9aaa5b62515c24cfe97986945fb84870a22e183b74c;
newtestf4e3510cac959f15bf362e54c1abf96952afd169255b1748434f8bc69d144702.
Browser5c72cf028235a427e0eb79859e5e9b497c6465e84de2e122803805a830ed57a8.
All logs, source manifests and fresh asset hashes retained with task evidence.

Actual root commands from the component source (all through shared issue-sweep launcher):
`T110-red1 -- python3 T110-private-run.py python3 T110-web-run.py red`,
`T110-unit1 -- python3 T110-private-run.py python3 T110-web-run.py unit`,
`T110-browser1 -- python3 T110-private-run.py python3 T110-web-run.py browser`.
Runners live in the local sweep evidence directory and bind this exact source worktree;
commands above abbreviate their absolute private paths. RED is expected exit1; final
unit/browser exit0. No credential, host path or private DB contents published.

Product scope is ResultArchive download only; shared API/ExportPanel/backend unchanged.
Legacy browser archive-prune disables an immutable guard; it remains unexecuted by
this milestone. New test helper reuses owned synthetic historical firstINSERTs,
approves exacttwo archive IDs, validates immutable metadata/payload hashes and
preserves full run/task/profile/event/identity/authority facts. The browser observesB;
no eventGC/export mutation. Metadata network failure is deliberately injected; actual
download410 and GC/API remain real. No observed31-day lifecycle, live acceptance,
fullfake faultmatrix, VMrecovery/deployment or M4 completion.
