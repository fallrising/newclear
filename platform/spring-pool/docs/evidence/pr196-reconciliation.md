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
- `npm test`: PASS,39 named tests,0failed/0skipped,9.133s after both review fixes.
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

### Final review correction

The bounded reviewer follow-up accepted capture/build/icon/multiline changes and
confirmed the missing doctype. Root added a response-prefix test (RED), then
prefixed the escaped Hono JSX template with literal `<!doctype html>` (GREEN).
All39named Node tests, typecheck, format and web dry-run pass; the browser helper
now also asserts `document.compatMode === "CSS1Compat"`. Final named unit output
is retained in the local `artifacts/pr196/node-final.log`; CI will retain the same
suite output. No assertion was removed and no raw user HTML was introduced.

Root index preflight: PASS,51contracts and8llms files. PR diff against integrated
main passes `git diff --check`. A naive staged check against the September feature
HEAD reported pre-existing whitespace in incoming main history; that content was
preserved and the actual PR delta was checked against the merged main instead.

### CI runner correction

[Run41278663845](https://github.com/fallrising/newclear/actions/runs/41278663845)
on aded283d passed nativequality,build and realintegration, then all8 browser
launches failed before page execution with `No usable sandbox`. This is not a
product-browser pass. The new doctype head could not start CI while a concurrent
main addition caused a rootPLAN append conflict; all other work was preserved.

Correction1 pins `ubuntu-22.04`, still listed in the
[official runner catalog](https://github.com/actions/runner-images/blob/main/README.md),
instead of the Ubuntu24.04 latest image. Chromium sandbox and all acceptance
assertions remain enabled. No sysctl, AppArmor or permissions are changed. This
is a runner compatibility hypothesis until the new CI browser result arrives.

[Run41279099301](https://github.com/fallrising/newclear/actions/runs/41279099301)
on49e09f5b reached Node tests:38passed/1failed, because Ubuntu22.04's default
Python3.10 lacks stdlib `tomllib` required by the unchanged API privacy config
guard. Add the repository's pinned setup-python action with Python3.12; do not
replace or skip the parser assertion. A sandbox launch preflight now runs before
quality gates so browser compatibility is observed directly. Browser cases and
rendered evidence were skipped by that failed gate, not passed.

Root also removed the redundant “Not saved” heading while preserving the SDD's
exact conflict notice; this avoids two visible matches for the original conflict
journey. The normal screenshot fixture uses a short code line; no overflow check
or product code-scrolling behavior changes. These two small final changes await
the same original browser gate.
