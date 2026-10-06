# Native workspace acceptance verification

Six Linux native scenarios passed together on 2026-10-05, using the [acceptance specification](workspace-acceptance.md). This is a bounded functional slice, not a claim of complete desktop or cross-platform acceptance. The [sanitized evidence manifest](evidence/workspace-acceptance-linux.json) records hashes, versions, cases and earlier findings.

## Tested source and environment

Runtime source: `152c75a5cd975d3c9112520e615ae5e4c904dd67`, following specification commits `664582ba` and `d9672b0c`. The final test-only harness includes subsequent WebDriver/readiness corrections; its SHA-256 is `8114e3d169a8aa68335ea8d966e5d409929cdae406da3f1c8f3787c01987a27f`. No runtime code changed after the tested source commit.

The real Tauri debug binary ran in a Debian 12 x86_64 Docker container, with WebKitGTK/WebKitWebDriver `2.50.6-1~deb12u2`, tauri-driver `2.0.4`, Python `3.11.2`, Xvfb at 1920×1200 and Openbox. The native application window was set to 1800×1000. Rust is pinned to 1.88. The reused binary has SHA-256 `4c5b7ce86049495d0aceb87c9a3b75277508c2ce0c6014c9bb8a7c08977ec069`; its Rust/contract/Cargo inputs are unchanged from the prior window-close build.

The debug binary loaded the newly built production frontend over the local development URL. All three actually served files matched the local build hashes. The JavaScript bundle hash is `b084e5771d1dd5c7ff02a9e040be475ef77a301867ef1e9d8f1158857b59d4ab`. A separate inventory matched 138 local/native source and build-input files, including the input-order repair. An earlier test-directory source snapshot had three stale TypeScript files; it was replaced before this run rather than being represented as the final source.

## Results

| Native case | Observed result |
| --- | --- |
| External changes | Two clean reloads; local dirty text retained during conflict; Keep/Save and a subsequent conflict exercised |
| Named routing | Real shell PID proves Run used the named target; synthetic edge matches; actual expanded output captured and unrelated terminal output excluded |
| Pin persistence | Real captured output pinned/saved; saved file, document nodes, edges and terminal tombstones survive relaunch |
| Restart without automatic execution | Saved startup command does not run on relaunch; explicit Restart creates a fresh session while retaining old history and rewiring the existing edge |
| History actions | Natural exit code 7 recorded; Restart adds one fresh node/session; Forget removes metadata while preserving document files and canvas topology |
| Removal and fallback | Closing target terminates its shell and removes incident edges; Run without named override executes in the remaining terminal |

The final single invocation returned exit 0 with all six cases passed. Each case used a fresh disposable vault and real PTY/filesystem/SQLite behavior, without mocked IPC or direct invocation of application commands. Raw HTML, screenshots, fixtures, driver logs and summary JSON are retained locally for review; public evidence is sanitized and does not promise cross-host retention of raw files.

Frontend verification run by the worker and rerun by the orchestrator: `npm test` (227 tests in 22 files), `npm run typecheck:contracts`, `npm run typecheck:app`, and `npm run build` passed. The build retains Vite's large-chunk advisory. Four focused input-order regressions passed after two expected pre-fix failures. Harness syntax compilation and `git diff --check` passed. The delivery PR's Loom CI supplies the fresh Rust, formatting, generated-contract drift, clippy, frontend and build gates; consult that PR's head checks for their final status rather than treating the native run as a Rust-test rerun.

## Repair and earlier failures

Native rapid keyboard input exposed an actual product regression: correctly ordered browser key events could arrive in the PTY with adjacent characters swapped. Independent asynchronous `pty_write_stdin` invocations did not preserve frontend submission order. The shared frontend `writeStdin` boundary now queues writes separately for each session, waits for each native acknowledgement, retains each caller's error, continues after rejection, and removes idle queue state. Different sessions remain independent. Deterministic tests exercise held acknowledgements through the actual exported function used by keyboard input and document Run. Native typing was not throttled to hide the problem.

Earlier harness failures were kept as diagnostics: WebKit required explicit Ctrl+A actions and Enter key events for editor replacement; an animated canvas made a pointer-based rename interaction unreliable; a transient driver connection reset required a bounded retry of a read-only session-ID query. Buttons are activated through DOM click/focus, while text travels through native WebDriver keyboard events. The harness never retries mutations or injects editor/ReactFlow internal state.

One earlier 1100×720 run displayed nodes but no SVG edges, including a persisted context edge. Its cause is unresolved. The final harness fixes the test viewport and waits for visible node/handle measurements and stable Fit View geometry, preserving the same edge assertion. The final pass does **not** establish a canvas code repair or reliability at every viewport/startup timing.

## Reproduce on Linux

Install Tauri's Linux prerequisites and test-only WebKitWebDriver, tauri-driver 2.0.4, Xvfb, Openbox and xdotool. Build the selected source (`npm ci`, `npm run build`, then `cargo build --locked -p loom-core --bin loom` from `apps/loom`). Use an isolated X display and window manager, and serve this exact `dist` directory on the debug binary's configured `http://localhost:1420` URL. Verify the served bytes against the build; `--frontend-dir` records hashes but alone does not prove which bytes a server delivered.

Example harness invocation, with operator-selected absolute paths:

```sh
DISPLAY=:99 python3 scripts/native_workspace_acceptance.py \
  --binary /absolute/cargo-target/debug/loom \
  --test-root /absolute/disposable-evidence \
  --frontend-dir /absolute/checkout/apps/loom/dist \
  --source-commit "$(git rev-parse HEAD)"
```

This is a reproduction template, not a claim that these example paths exist. The executed run used the same script and all six default cases in the test container. Supply a 1920×1200 display, free driver ports 4444/4445 and no unrelated Loom windows. The harness creates new fixture directories, strips provider credentials with an environment allowlist, owns its driver/application processes, and retains evidence instead of deleting caller data. The caller must stop its own display/window-manager/HTTP processes after the suite.

## Limits and follow-ups

Windows and macOS were not exercised; see the [Proxmox Windows VM and platform setup guide](native-platform-acceptance.md). Pointer hit-testing, dragging, accessibility, arbitrary DPI/window sizes, physical graphics hardware, provider calls, performance/soak behavior and unsaved-buffer crash recovery are outside this run. The earlier missing-edge observation remains a focused follow-up investigation. `feeds_output_to` still does not execute commands or supply Run/Pin capture, and no deferred plugin/runtime capability was added.
