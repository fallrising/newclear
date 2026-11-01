# Development and acceptance status

Updated 2026-10-05. This is a current maintenance inventory, not approval to restart the historical feature roadmap. Earlier dated verification pages retain their original evidence.

## Implemented capabilities

Loom is a desktop prototype with real PTY sessions, document editing and optimistic saves, atomic no-replace file creation, canvas persistence, OpenCode Go integration, SQLite session metadata/history recovery, AI request cancellation, and document-node close protection. Normal window-close protection is delivered by the [window-close repair](window-close-safety.md); see its separate verification for native evidence. Passing automated checks does not establish an arbitrary product-completion percentage.

SQLite recovery restores session metadata/history and offers explicit restart; it does not reattach a dead process, replay all PTY output, or recover unsaved editor text. Document files remain the source of saved content.

## Remaining work by purpose

| Priority | Work | Current boundary |
| --- | --- | --- |
| Completed Linux acceptance slice | Six native scenarios: restart/history, external file changes, Run/Pin and terminal routing | [Evidence and limits](workspace-acceptance-verification.md); fixed viewport, DOM button activation, no pointer/drag coverage |
| Follow-up investigation | Intermittent missing SVG edges during smaller-window startup | Earlier 1100×720 attempt retained; cause unresolved, no canvas code repair claimed |
| Next platform work | Windows WebView2 and macOS WKWebView build/native interaction matrix | Linux Docker proves neither operating system; use actual OS runners or VMs |
| Useful follow-up capability | Recover unsaved document buffers after a crash/restart | No dirty-buffer recovery store is implemented; requires its own persistence/retention specification |
| Optional robustness work | Load/soak testing for many terminals, large documents and long AI streams | Functional regression counts are not performance evidence |
| Known filesystem limits | Cross-process compare-and-swap and hostile ancestor/symlink replacement | Existing hash and preflight checks retain their documented limits; stronger guarantees are separate work, not implied by this repair |
| Deferred roadmap | MCP, capability gates, plugins and inbox | Historical design/backlog, not part of the approved maintenance work |

The native workspace acceptance slice also repaired per-session terminal input ordering; it does not add deferred capabilities. OpenCode Go has prior provider evidence; additional provider/model combinations are separate acceptance choices rather than a blocker for this repair.

## Platform validation strategy

Docker containers share their host kernel; a Linux container on this VPS supplies Linux acceptance. Merely using Docker Desktop on a different host still does not turn a Linux container into a Windows or macOS native application. See [Docker's container explanation](https://www.docker.com/resources/what-container/).

| Platform | Suitable route | Evidence supplied by Linux Docker |
| --- | --- | --- |
| Linux | Tauri binary + WebKitGTK + tauri-driver + Xvfb/window manager | Real Linux native close events, UI and filesystem/PTY behavior can be exercised |
| Windows | Windows runner or Proxmox VM, WebView2 and matching Edge WebDriver | None for native Windows behavior; cross-compilation alone would only be build evidence |
| macOS | macOS runner/VM; manual native smoke or the documented embedded WebDriver service | None for native macOS behavior |

The [Tauri WebDriver guide](https://v2.tauri.app/develop/tests/webdriver/) documents the direct tauri-driver path for Linux/Windows and an embedded WebdriverIO service route that also supports macOS. The latter requires test plugins/dependencies not introduced here. The [Tauri CI guide](https://v2.tauri.app/develop/tests/webdriver/ci/) describes Linux Xvfb/native-driver setup. A paid macOS testing service is not used. The test-only tauri-driver is pinned to 2.0.4, compatible with this repository's Rust 1.88 toolchain.

For operator instructions and VM limitations, see [native platform acceptance setup](native-platform-acceptance.md).
