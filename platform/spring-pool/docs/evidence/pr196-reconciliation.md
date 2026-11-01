# PR196 reconciliation — 2026-11-01

Status: IN PROGRESS; no product merge or complete acceptance claimed.

Original source: `2eb29676863869a67f90dc68b8332ff1db87078e`.
Tracking: [PR196](https://github.com/fallrising/newclear/pull/196),
[issue393](https://github.com/fallrising/newclear/issues/393), desk T-0356.
The owner requested oldest-first inspection of later updates, mergeability and
repair of missing gates. No feature successor was found in the PR search or
mainline component tree. Only seven original feature commits touch this component.

## Plan and boundaries

Preserve the original SDD/API/acceptance assertions. Complete the missing web
Worker and pages, integrate current main indexes, run original local quality,
Wasm/D1 and browser gates, then obtain independent review and required CI before
normal publication/merge. Reversible local integration is authorized; old
24-hour staging/five-provider authorization is expired. No deployment, new
runtime dependency, release, credential changes or scope reduction.

Estimated active work90–150minutes; progress checks every20active minutes.
Build/test host deadlines15minutes, CI wait15minutes; two hypothesis-driven
diagnostic/correction attempts per unchanged blocker. One native inherited-model
web leaf writer (35minutes), one native read-only independent reviewer (15minutes
plus at most one bounded correction follow-up). Root owns integration/acceptance.
Model/provider/tokens/cost and exact active/wait split remain unknown unless observed.

## Observed baseline

- Read-only `git merge-tree --write-tree <original-head> origin/main`: FAIL,
  conflicts only in root README.md and PORTFOLIO.md. Both added entries are retained
  during integration; unrelated main content is preserved.
- `npm ci --no-audit --no-fund`: PASS,43locked packages. npm reports esbuild/workerd
  install scripts not covered by allowScripts; no policy override was made.
- `npm run lint`: PASS on existing auth/CSRF helpers; this does not prove missing pages.
- Original `node --test tests/config/*.test.mjs` under the native sandbox stalled.
  A single-process diagnostic with30s deadline ended124 and reported
  `spawnSync python3 EPERM`; no test weakening was retained. The two owned original
  processes were stopped using exact cwd/argv checks and pidfds.
- The unchanged config command through normal execution escalation completed in
  98.8ms:2tests,1PASS/1FAIL,0skip. Failure is precisely missing
  `web/wrangler.jsonc` in T-AUTH-4/T-BOUND-1. This is the implementation RED.
- `cargo install worker-build --version 0.8.7 --locked`: FAIL101 because the host
  lacks OpenSSL development headers. The correction uses the matching Ubuntu
  libssl-dev package in shared user cache and static linking, not a system install.
  Package SHA256: `2b4734df0475e305ac03abb0a2cc5659651ed37ef02d967a1c4033a154cf714b`.
  First correction still lacked the multiarch include; explicit multiarch CFLAGS
  completed worker-build 0.8.7 installation (2m03s). No host package installation.

## Final local evidence before CI

- `cargo test --manifest-path api/Cargo.toml --locked`: PASS,46 tests; doc tests0.
- `cargo fmt --manifest-path api/Cargo.toml --check`: PASS.
- Host `cargo clippy --manifest-path api/Cargo.toml --locked --all-targets -- -D warnings` and Wasm target Clippy: PASS.
- `npm run lint`, `npm run format`: PASS.
- `npm test`: PASS,38 named tests,0failed/0skipped,9.643s after review fix.
- `npm run build`: PASS, compiled Rust/Wasm and web dry-run. Follow-up `npm run build:web`: PASS after correcting the old output path so generated README and bundle remain inside the component. No lockfile/dependency change.
- `npm run test:local:integration`: PASS,21 real API/web contracts plus separate seed and byte-identical persistence/export checks after API restart.
- `node scripts/browser-evidence.mjs --mode self-test`: PASS. This is tool self-test only, not rendered evidence.
- Independent T-994 code review found CRLF in multiline descriptions/instructions was rejected by the API. Focused test first failed, then passed after LF normalization. Reviewer independently repeated the capture assertions; real integration also passes. Uploaded file decoding stays byte-preserving. No remaining blocker in reviewed web code; full acceptance remains root-owned.
- Local native Chromium preflight failed on missing system libraries. Existing nonroot read-only container supplied the libraries; profile/XDG paths were corrected, then Chromium explicitly failed `No usable sandbox`. No sandbox was disabled or host policy changed. Browser acceptance moves to the existing CI runner with `chromiumSandbox: true` unchanged.
- Full original browser assertions remain; multiline inputs were added to the no-JS journey. The local harness now also saves list/detail/step-editor PNG and health JSON at1440,768,390px using the requested evidence runner through an already sandboxed CDP endpoint. Rendering remains pending until CI artifacts are inspected.
- Project index initially detected the old dry-run output as a project, then detected missing root llms navigation. Both specific causes were corrected; final gate recorded below.

## Remaining gates

Original browser journeys, responsive PNG inspection, required GitHub CI and remote
readback are pending. No completion, deploy or usable-tag claim. Protected staging
and owner acceptance remain separate, with the old grant expired.
