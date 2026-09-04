# B2 Acceptance Mapping (03-acceptance §B2)

Run with `cargo test -p loom-core` (all tests) or
`cargo test -p loom-core --test fs_integration` (just B2 acceptance).

| # | Criterion | Test(s) | Mode |
|---|---|---|---|
| **B2-1** | App self-write does NOT trigger a reload event (echo guard hits). | `fs_integration::b2_1_self_write_does_not_trigger_reload` | `[auto] P0` |
| **B2-2** | Pure external change → Modified surfaces. | `fs_integration::b2_2_external_change_emits_modified` | `[auto]` |
| **B2-3** | External change while editor is dirty → not silently overwritten; `check_conflict` returns `Conflict`. | `fs_integration::b2_3_external_with_unsaved_is_a_conflict` | `[manual] P0` (verified by integration test; UI gate waits on C2/E0) |
| **B2-4** | Rename storm: final state converges; no missed events leading to inconsistent state. | `fs_integration::b2_4_rename_storm_state_converges` | `[auto]` |
| **B2-5** | `.md` content is byte-for-byte from filesystem; no DB cache. | `fs_integration::b2_5_md_content_is_byte_exact_from_filesystem` | `[manual]` (auto-checked by test) |

## Plan §6 contract decision (option A) — recorded outcome

Implemented as planned: `DocumentService::check_conflict(path)` is the
backend's hash-based answer for the frontend to consult after a watcher
event. No new contract event variant; `Event::FsChanged::Modified` flows
unchanged whether or not it's a conflict, and the frontend decides what
to do with it based on its editor state + this API call.

## Plan §0 defaults — recorded outcomes

| # | Decision | Outcome |
|---|---|---|
| 1 | `notify` v8 | Adopted (v8.2.0). |
| 2 | Debounce window 100 ms (env `LOOM_FS_DEBOUNCE_MS`). | Implemented; integration tests use 40 ms via `start_with`. |
| 3 | blake3 hashing. | Adopted (v1.x). |
| 4 | `vault_root` is a constructor parameter, not env-read. | Implemented; `DocumentService::new` and `FsWatcher::start` both accept it. |
| 5 | Echo TTL 500 ms. | Implemented as `DEFAULT_ECHO_TTL`. |

## Mid-flight changes from plan

- **EchoGuard semantics**: the plan said "consume on first match." Integration testing revealed that macOS produces multiple events per self-write (Created + Modified, sometimes more), and the reconcile scan can re-detect the same path within the TTL. Switched to "TTL-only cleanup; matches do not consume" — see `echo_guard::tests::matching_hash_is_repeatable_within_ttl`.
- **Hidden-file filter**: `atomic_write` writes via `.<name>.tmp.<uuid>` temp files; those events would otherwise leak. Added a shared `is_hidden` filter applied to both notify-driven and reconcile-driven emits.
- **Reconcile must apply echo filter too**: if only the notify pipeline checked echo, reconcile would re-emit a self-write Created within the 60 s window. Both pipelines now share `should_emit`.

## Manual gates still owed

- **B2-3 UI confirmation**: the "reload / keep" prompt itself lives in C2 (editor surface). Backend correctness is fully covered; the user-facing dialog needs the editor surface to exist before it can be ratified.
- **B2-5 manual byte-check**: integration test asserts byte-for-byte round-trip; a human-verifiable demo of "Loom write → Obsidian shows same bytes" needs the editor surface.

## Live demo

```sh
cargo run --example fs_demo
# self-writes get suppressed; external writes surface; conflict status is printed.
```
