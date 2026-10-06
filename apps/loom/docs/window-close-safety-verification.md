# Window close protection verification

Verified 2026-10-05 against the integrated window-close repair. The [specification](window-close-safety.md) defines ordinary main-window closure; the [development inventory](development-status.md) lists work beyond this slice.

## Automated checks

| Check actually run | Result |
| --- | --- |
| `npm test` | 223 tests in 21 files passed |
| `npm run typecheck:contracts` and `npm run typecheck:app` | Passed |
| `npm run build` | Passed; existing large-chunk advisory remains |
| `cargo test --locked --workspace --no-fail-fast` | 201 tests passed |
| `cargo fmt --all -- --check` | Passed after correcting formatting in the new native module |
| `cargo clippy --locked -p loom-contracts --all-targets -- -D warnings` | Passed |
| `cargo build --locked --bin loom` | Passed |
| Generated contract inventory comparison | All 27 generated files matched the source checkout by path and SHA-256 |
| `git diff --check` | Passed |

Document participant, coordinator, canvas wiring and native interception tests cover stale lifetimes, membership/revision changes, sequential partial saves, conflicts, missing files, busy operations, cancellation, duplicate requests and failed native dispatch. Independent review also caught and repaired an already-approved document close being stranded by the window prompt, and a conflict state being bypassed before React rerender. A browser regression exposed focus restoration on Cancel; the corrected implementation restores the original editor focus.

Production frontend browser tests with mocked Tauri IPC passed **11 new window-close flows**: clean close; dirty Cancel with focus restoration; Save all for two documents without node removal; Discard without document writes; failed-save retry; conflict protection; cancellation of pending saves and duplicate requests; pending metadata acknowledgement; native dispatch failure; canvas flush failure; and pending AI work. The baseline failed all 11 because no window-level listener/prompt existed. The existing document-close browser suite also passed **14 flows** against the integrated build before the final conflict-reference and focus corrections; the final 223-test frontend suite includes those corrections.

## Real Linux native acceptance in Docker

This was a real Tauri binary using WebKitGTK and real filesystem/PTY commands, separate from mocked browser tests. The test environment was Debian 12, Rust 1.88, test-only tauri-driver 2.0.4, WebKitWebDriver, Xvfb and Openbox. No application dependency or lockfile was changed. The test used a disposable vault and removed provider key environment variables; no provider request was needed.

The baseline binary was copied to an isolated path. Sending the actual window-manager `WM_DELETE_WINDOW` client message after editing a document destroyed its window while the disk still contained the original text: a reproducible loss of the unsaved buffer. Keyboard Alt+F4 automation did not reliably deliver that event, so it is not the regression evidence.

The repaired binary passed **5 native scenarios**:

1. Dirty Cancel preserves the buffer; subsequent Discard closes without writing it.
2. Save all persists two files and preserves two canvas nodes and their edge.
3. An external disk edit causes a conflict, keeping the window and dirty local buffer open; Cancel and explicit Discard remain usable.
4. A clean workspace closes normally.
5. Closing a real terminal workspace terminates its shell child and records exited/tombstone session state in SQLite.

One initial Save-all assertion failed because WebKit's `innerText` included a layout-generated trailing newline. The disk content was correct. Reading CodeMirror line `textContent` instead fixed the test oracle; no product save behavior was changed for that mismatch. The final native run passed all five scenarios.

## Boundaries

Linux Docker acceptance does not validate Windows WebView2 or macOS WKWebView. Those native platforms remain untested here. See the [official Tauri WebDriver guide](https://v2.tauri.app/develop/tests/webdriver/) and [Linux CI setup](https://v2.tauri.app/develop/tests/webdriver/ci/), plus the platform matrix in the development inventory.

These checks establish ordinary main-window close behavior, including normal PTY shutdown. They do not establish crash recovery, force-kill/logout guarantees, arbitrary OS quit-menu behavior, full workspace desktop acceptance or performance under load. Cancel cannot undo already submitted writes; Discard does not reverse an in-flight write. A native destruction already dispatched is the final commit point. Frozen contracts, schemas, fixtures and application dependencies are unchanged.
