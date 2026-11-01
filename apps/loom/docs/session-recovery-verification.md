# Session recovery verification — 2026-10-04

This delivery implements [session-recovery.md](session-recovery.md). It connects desktop startup and terminal lifecycle to per-vault SQLite and adds the history panel. The earlier [reliability report](verification-2026-10-04.md) remains a record of its own revision.

## Validation scope

| Executed check | Final observed result |
| --- | --- |
| `cargo test --locked --workspace --no-fail-fast` | 156 passed: 37 contracts and 119 core/unit/integration |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --locked -p loom-contracts --all-targets -- -D warnings` | Passed; contract crate only |
| Generated TypeScript comparison after Rust tests | All 26 paths and SHA-256 hashes unchanged |
| `npm test` | 99 passed across 12 files |
| `npm run typecheck:contracts` / `npm run typecheck:app` | Both passed |
| `npm run build` | Passed |
| Built-UI Chromium flows with mocked Tauri IPC | Five recovery flows plus five document/sidecar regressions passed |
| `cargo build --locked -p loom-core --bin loom` | Passed with Linux native dependencies and Rust 1.88 |
| `python3 scripts/native-recovery-smoke.py --binary target/debug/loom --dist dist` | All four native checks below passed under Linux/Xvfb |
| `git diff --check` and team report validators | Passed |

Backend regression tests use real Linux PTYs and on-disk SQLite. They cover reopen/reconciliation, instant exit, restart with a fresh ID and retained history, unavailable working directories, live-session rejection, corruption preservation, symlink preflight, ownership contention/release, storage failure, and naturally exited history actions. The permission-denied case was also executed as an unprivileged user because a root container bypasses ordinary file permissions.

The actual built frontend passed five mocked-Tauri browser recovery flows: listener/read ordering and errors; canceled restart and cleanup retry; successful restart/forget preserving a dirty document; exit before attachment; and unsupported-sidecar protection. Five existing document/sidecar browser regressions also passed. These exercise the built UI, but do not establish native IPC interaction.

Independent backend/frontend review found and repaired early-exit attachment and unmounted-cleanup gaps, natural-exit history eligibility, and relative working-directory persistence. The first final workspace run exposed an existing detach race: aborting a batcher task did not wait for a synchronous sink emission. A controlled in-flight-emission regression reproduced it before the synchronization repair. The failing run remains part of the evidence rather than being counted as a pass.

## Reproduce native boot/recovery

In a disposable Linux environment with the native dependencies listed in the README, plus Python 3, Xvfb and `xauth`:

```sh
cd apps/loom
npm ci --ignore-scripts --no-audit --no-fund
npm run build
cargo build --locked -p loom-core --bin loom
python3 scripts/native-recovery-smoke.py --binary target/debug/loom --dist dist
```

The script serves the built frontend on local port 1420, starts the actual debug Tauri binary with disposable vaults, and requires a native-created queryable database and a successful frontend JavaScript response. With the app stopped, it seeds a claimed-active row whose command would create a marker. Two relaunches must turn that row into a stable tombstone without producing the marker. Markdown and an unsupported sidecar must remain byte-identical. A separate corrupt database must remain byte-identical while the app still starts. Process-group cleanup and guard-lock acquisition verify ownership release before relaunch. The test-only WebKit sandbox override applies only when running this script as root in the disposable container.

The baseline binary failed because it did not create a session database. Initial updated-binary attempts exposed WebKit's persistent frontend cache: native-created rows were present, but the test received no new HTTP request. The final script isolates each boot's XDG browser profile and disables server caching; all four native checks then passed. This was a harness repair, not a change to recovery behavior. The smoke covers native boot/reconciliation, not interactive GUI Restart/Run/Pin or graceful window-close acceptance.

## Remaining limits

No PTY output, dirty editor buffer, or operating-system process is restored. Restart reruns the saved command explicitly. Persistent history is unavailable for a runtime that has degraded to memory; restart the app after correcting the storage problem. Concurrent-instance protection applies to session metadata, not cross-process document compare-and-swap. Symlink checks remain preflight checks rather than protection against hostile concurrent path replacement.

Windows/macOS and live AI-provider acceptance remain deferred. No provider credentials or live OpenCode calls were used. Full native interactive acceptance and performance/stress testing remain separate work. Existing Vite deprecation and bundle-size warnings remain.
