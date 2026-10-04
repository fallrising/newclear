# Native workspace acceptance

Status: acceptance specification, 2026-10-05. This slice verifies the existing desktop workspace after window-close protection; it does not add crash recovery or restart the deferred feature roadmap. The starting runtime is commit `363cecf98fcb2a6543edfb15aa2ae15f75065423` (window-close implementation PR #288).

## Required Linux scenarios

Use a real Tauri binary, WebKitGTK, WebDriver, a desktop display/window manager and a newly created disposable vault. Assertions must inspect visible UI plus actual files, PTY effects and SQLite metadata where applicable. Drive user actions through UI; fixture creation and external file edits may use host filesystem operations. Do not substitute mocked IPC or invoke application commands to bypass the UI under test.

1. **External document changes:** a clean document follows two consecutive external disk edits without becoming dirty. After local editing, an external change preserves the local buffer and presents a conflict. Explicit Keep followed by Save uses the confirmed version; another external change before Save must conflict again rather than overwrite silently.
2. **Run and named routing:** create real terminals, assign distinct names, and open a runnable document with `run_in` targeting one terminal. Run executes in that terminal, the other terminal does not execute the command, and the synthetic routing edge corresponds to that target. Capture is tied to the actual target session, not unrelated terminal output.
3. **Pin and persistence:** pin a real Run result into the document, save it, and reopen the workspace. The saved Markdown contains the pinned result; document/node/edge persistence is preserved. `feeds_output_to` is not treated as an execution or capture mechanism.
4. **Restart without automatic execution:** save a workspace containing a live terminal and document, close normally, then relaunch. Restore document/layout/connections and a terminal tombstone. Relaunch does not execute the saved command. Explicit Restart creates a new session and resumes the intended terminal behavior while preserving the original history row.
5. **History actions:** a naturally exited or tombstoned session appears in history. Explicit history Restart attaches a fresh session/node without duplicating existing topology. Forget history removes only its stored metadata, retaining existing canvas nodes and document files.
6. **Terminal removal and fallback:** closing a terminal terminates its child, removes incident routing edges, and leaves the remaining terminal usable. Run with no named override follows the remaining active terminal and does not target the removed session.

A scenario may be split into smaller cases for reliable cleanup and diagnostics. Record exactly which cases run; do not infer full platform or feature completion from the count. A failing test oracle must be corrected with evidence, separately from a product regression. Product behavior changes require a failing regression before the repair.

## Harness and evidence

Use Python standard-library WebDriver HTTP orchestration with test-only system tools; introduce no application dependency or frozen-contract/schema changes. The harness must require an explicit existing application binary, use a newly created temporary vault under an explicit test directory, and never delete or overwrite a caller's existing vault. Provider credentials must not be passed to the app. Test-only driver processes and servers must be cleaned up; retained fixture/evidence paths must be printed. Prefer observable conditions to fixed sleeps, include bounded timeouts, and exit nonzero if any required case fails.

Record the source commit, binary and production-frontend hashes, driver/tool versions, passed/failed cases, relevant artifact paths, and limits. Independently review both the harness oracles and any product repairs. Run syntax checks and the real native suite; if runtime changes, rerun relevant regression tests and the existing frontend/Rust/typecheck/build/drift gates. Deliver the specification before the implementation/evidence commit and stop at PR/CI plus task review.

## Platform extension

A Proxmox QEMU/KVM Windows VM running Windows itself can supply native Windows application acceptance: build/run the Windows binary with WebView2, a matching Edge WebDriver and an interactive desktop session. A Linux VM or container still supplies Linux evidence only. Prepare a clean snapshot and record Windows/WebView2/build versions; verify the same user workflows before calling that platform accepted. VM functional evidence does not establish physical-GPU, monitor/DPI, peripheral or hardware performance coverage.

For Windows build prerequisites use [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/); for automation use [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/) and [manual setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/). The Proxmox [QEMU/KVM guide](https://pve.proxmox.com/pve-docs/chapter-qm.html) and [Windows guest guide](https://pve.proxmox.com/wiki/Windows_11_guest_best_practices) describe VM setup. Provisioning or reinstalling a VM is separate from running this test suite.

macOS needs a macOS host/guest and a suitable native test method. Apple's [macOS license](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf) includes Apple-branded-hardware conditions for virtualization; prefer a Mac or VM on a Mac. Direct tauri-driver supports Windows/Linux; Tauri's embedded WebDriver route for macOS requires additional test plugins not included here. No Windows/macOS pass is claimed without a supplied, exercised environment.
