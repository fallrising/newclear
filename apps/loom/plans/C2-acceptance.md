# C2 Acceptance Mapping (03-acceptance §C2)

| # | Criterion | Where | Mode |
|---|---|---|---|
| **C2-1** | runnable block 雙模式 + ▶ + output section | `runnable_block.ts` StateField. `tauri dev` confirms ▶ + placeholder render. | `[manual]` (live verified) + parser unit tests |
| **C2-2** | `^block-id` + `[[#^id]]` Obsidian 相容 | `block_id.ts` only adds decoration; raw bytes unchanged. Verified by reading the saved file under `~/loom-vault/notes.md`. | `[manual]` + parser unit tests |
| **C2-3** | output section 容納 `feeds_output_to` snapshot 結構 | `OutputSectionWidget` placeholder exists in DOM with the announced classname; C4 will populate it. | `[manual]` (structure check) |
| **C2-4** | ▶ 發 `Origin::User` Command (不自己路由) | `doc_ipc.docWrite` ships `origin: { kind: "user" }`; the runnable button currently only logs (C4 will inject). The save path is the one that hits backend with `Origin::User`. | `[auto]` (TS unit covered) |
| **C2-5** | 三 golden state 快照不跑版 | Live verified via `tauri dev`; no Playwright pipeline yet. | `[manual]` (snapshot pipeline deferred) |

### Bonus verified live
- B2-3 conflict: `tauri dev` with editor dirty + external `echo x >> notes.md` → conflict banner appears, Reload / Keep buttons both function.
- C2 self-write (Cmd+S): no re-render thrash because echo guard suppresses our own watcher event (B2 path).

### Tests

```
cargo test --workspace      → 104 Rust tests
npx vitest run              → 16 TS tests
npm run typecheck:app       → 0 errors
npm run typecheck:contracts → 0 errors
cargo clippy ... -D warnings → clean
cargo fmt --check           → clean
```

### Mid-flight discoveries

- CodeMirror 6 blocks plug-ins from emitting `block: true` decorations.
  Refactored `runnableBlockExtension` from `ViewPlugin` to `StateField`
  with `provide(f) => EditorView.decorations.from(f)`. The error message
  on first try was `RangeError: Block decorations may not be specified
  via plugins`.
- `setup` callback runs outside any tokio context, so `FsWatcher::start`
  (which spawns tokio tasks) panicked. Same shape as the V slice issue:
  enter the global tokio runtime via `tokio_handle.enter()` for the
  duration of `setup`.

### Plan §10 default answers — confirmed in code

1. Connect to real B2 (no mocks) ✅
2. 50/50 horizontal split, no drag-resize ✅
3. `LOOM_VAULT` env or `~/loom-vault` with auto-mkdir ✅
4. `[[file#^id]]` click → toast only, no navigation ✅
5. ▶ click → toast only, no real inject ✅
