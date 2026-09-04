# B1 Acceptance Mapping (03-acceptance §B1)

Each criterion is satisfied by one or more concrete tests. Run
`cargo test -p loom-core` to execute all of them.

| # | Criterion | Test(s) | Mode |
|---|---|---|---|
| **B1-1** | `cat largefile` / build-log flood doesn't punch through the frontend; output batched per-frame (D-2). | `pty_manager::flood_pushes_through_batcher_with_dropped_old_under_pressure` | `[auto]` |
| **B1-2** | Channel full ⇒ **drop old, not new**: after a flood the tail (newest) is visible; `dropped_old` is non-zero. | `pty_manager::flood_pushes_through_batcher_with_dropped_old_under_pressure` <br/> `ring_buffer::push_beyond_cap_evicts_oldest_and_counts_drops` | `[auto]` |
| **B1-3** | Detach keeps the reader + ring alive; re-attach replays the buffer with no missing tail frame (D-5). | `pty_manager::detach_stops_emissions_resubscribe_starts_a_fresh_stream` <br/> `batcher::initial_replay_dropped_old_is_zero_even_after_eviction` | `[manual] P0` (visual confirm) |
| **B1-4** | Close window (tray-persist) → reopen → re-attach, PTY still live, buffer complete. | Same as B1-3 (within-process re-subscribe). Cross-process re-attach is daemon-split territory (TDD §2.1); MVP scope confirmed in B1 plan §1. | `[manual] P0` (window-level demo requires E0 shell) |
| **B1-5** | Re-attach fails ⇒ tombstone node + one-click restart with original cwd/cmd. **Does not crash.** | `boot_recovery::recover_tombstones_every_claimed_alive_row` <br/> `boot_recovery::restart_from_tombstone_spawns_fresh_session` <br/> `boot_recovery::restart_from_unknown_id_returns_not_found_without_crash` | `[auto]` + `[manual]` for the UI |
| **B1-6** | Session metadata (cwd / cmd / shell / state) correctly persisted and restored. | `session_store_persistence::persist_close_reopen_returns_same_rows` <br/> `session_store::store::tests::round_trip_*` | `[auto]` |
| (Bonus) | Corruption fallback never crashes; new sessions still spawn after fallback. | `session_store_persistence::corruption_falls_back_to_in_memory_without_crashing` | `[auto]` |

## Tests not directly mapped to acceptance but load-bearing for correctness

- `pty_session::*` — verifies the underlying spawn/kill/stdin/post-exit semantics.
- `ring_buffer::*` — eight unit tests covering monotonic seq, eviction accounting, stale-seq replay.
- `batcher::tick_loop_emits_per_batch_delta_drops` — the per-batch `dropped_old` delta from §0 question 2.
- `pty_manager::spawn_then_subscribe_emits_replay_with_dropped_old_zero` — initial-replay invariant (replay batch always `dropped_old = 0`).
- `pty_manager::pty_exited_event_emitted_when_child_exits` — `EventSink` integration with the exit watcher.

## Manual gates still owed

B1 plan §0 / collaboration §4-2 keep two P0 items as **human-gated** even
after all tests pass:

- **B1-3 / B1-4 visual confirm**: needs the E0-wired UI to actually demonstrate "close window, reopen, terminal still alive". Booked for the E0 acceptance pass.
- **B1-5 UI**: the "restart this session" button needs to be wired into a real surface (C1) before this is fully closed out. The backend behaviour is covered.
