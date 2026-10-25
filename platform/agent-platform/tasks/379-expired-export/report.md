# Expired export availability — local delivery snapshot 2026-10-26

Issue #379 / EUX01–02. Prior contract7ae9d2d9 precedes tests and real behavioral RED.
Baseline PR655 merge0b4e42d9cd27e4d4ede935f0a09c992c42fa58a7 showed stale archive and
approval controls after exact410 artifact_expired until a separate failed download.

Preview/approval now notify ResultArchive with their immutable source run/id/hash.
The parent immediately records local unavailability for that mounted identity and
refreshes only the originating run's artifact-query prefix. Known expiry hides
archive download/new-export controls while retaining summary/diff/hash/size; failed
refresh exposes its error/retry without resurrecting actions. A stale available
response cannot clear known expiry; server pruned_at is never fabricated or changed.
Late A response does not expire B. Preview401 now refreshes the session consistently;
other errors, lost response/PendingCommand keys and reconciliation remain unchanged.
This local UI state is not a persistent server tombstone or DB-restore authority.

## Verification

All new jobs used the shared launcher with source-bound private task mirrors,
read-only source/package cache, task-owned generated files and before/after hashes.

- T106-red1:18 rendered-App cases on unchanged product,6 expected behavioral failures
  and12 passed in8.81s. Exact preview/approval expiry, failed refresh, late-source
  refresh and preview401 failed; no import/environment error. Raw evidence retained.
- T106-unit1:TypeScript stopped before tests because new Testing Library role options
  incorrectly used exact:true. Replaced by equivalent anchored accessible-name regex;
  original RED test retained, assertions unchanged.
- T106-unit2:semantic type/format passed,24/25 cases passed. The remaining test's
  fixture incorrectly returned A's tombstone for every run, including B. Both root
  and independent reviewer confirmed the fixture error; scoped tombstone to A while
  preserving B's availability assertion. Original test/log retained; product unchanged.
- T106-unit3:18 new cases passed2.81s; five selected existing App archive cases passed
  3.51s,39 unrelated App cases intentionally unselected. Seven existing ExportPanel
  cases passed in unit2 with identical product source and were not replayed.
  Total30 distinct focused web cases passed. TypeScript and scoped Prettier passed.
- T106-browser1:rebuilt changed web assets with Vite, then one updated BGC Chromium/
  actual PostgreSQL/API/GC/fakeHTTP scenario passed9.6s. B approval410 immediately
  removes controls without another failed download; exact API410JSON/no-file/no-export,
  A single branch/PR, authority/result/hash/reload assertions remain. Before/after source
  equal; owned PostgreSQL/API/browser resources cleaned. Generated asset hashes retained.

Runner invoked targeted Vitest for ExportExpiry and ExportPanel, then App's archive
selection; fresh Vite build preceded the one m4-retention-export Playwright file through
scripts/test-postgres.py. No old Python700/756/OC/native or unrelated browser reruns.
Required hosted CI and normal merge remain delivery gates. Prior PR655 failures and
its dated BGC expectations remain historical; this correction supersedes the earlier
requirement to trigger a second failed download before refreshing B.

## Source and boundaries

- web/src/App.tsx: `91e5f2e1d3d7739367f7aa880156d3fb891c31a66e4dad91418e28d3995263d8`
- web/src/ExportPanel.tsx: `f7ee34acecbb9a5cd0c5d1c59bbb1dcaa2f6635b3c8d43a64f1b45299596e135`
- web/src/ExportExpiry.test.tsx: `f5ea47081f829aaa118f8b321842422b62890695329f406f0ca7005e3d52e7e8`
- web/e2e/m4-retention-export.spec.ts: `2eb67dde8a83fc265a6b5aeeccfbb1bd56c84d6583737fd1aa3c46ba6f4022ce`

Product change is limited to two frontend files. Backend authorization/idempotency,
GC, schema, dependency lock and CI workflows unchanged. Unit API errors are controlled
fixtures; browser uses real Chromium/TCP API/SQL/GC/exportworker with explicitly
synthetic historical rows and GitHub upstream. Full fake fault matrix, liveAT09/12/13,
unknown host residue, VM recovery/deployment and whole M4 remain open. No release/tag.
