# T-0410 Converted input bound

Demand: [desk T-0410](https://github.com/fallrising/desk/tree/main/tasks/T-0410-thinrouter-input-bound). Contract: [IB-1–IB-3](../../SUCCESS.md#t-0410--converted-input-bound).

Bound each converted input line before copying; preserve existing converter semantics within16MiB, including prefix/CR but excludingLF. Oversized input gets a fixed error and source release before final output, even after a finish_reason-only record. Process lines individually; do not reject a chunk simply for total size or inspect bytes after recognized completion. No generalized parser, total-output budget, session/deadline/provider change.

## Verification — 2026-10-25

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml ib1_oversized_lines -- --nocapture` failed at the first oversized unterminated source: no limit failure arrived within2s while the source remained open (idle60s). The original failure is retained. After the fix, focused GREEN passed. Per-line capacity growth now doubles only up to16MiB using reserve_exact, and every copy is preceded by a subtraction-based size check. No full incoming chunk is copied into the pending line buffer. On excess, discard retained line storage, feed a fixed error through the existing source-compatible envelope/conversion chain, and release the source before yielding final error output. Unlike EOF/stall finalization, an oversized usage tail after Chat finish_reason is a failure.

Added125scenario iterations across six tests:60excess cases (empty/partial/comment each6paths×3shapes, finish-reason-only2paths×3shapes);42boundary cases (6paths×7exact/below-limit LF/CRLF/EOF and chunk variants);6large chunks containing individually bounded comments plus recognized completion and oversized trailing bytes;6one-byte UTF-8/CRLF streams;1opaque oversized byte-preservation case;10realHTTP converted failures (Chat→Messages/Responses empty/partial/finish; Responses→Chat/Messages empty/partial). These are125matrix iterations, not125test-runner entries.

The adapter tests use a source that remains pending after its fixture bytes and assert source ownership has ended at receipt of the failure frame, before a further consumer poll. HTTP fixtures also remain open after their oversized bytes; all10replies complete within15s against60s idle and all10server-side drop notifications arrive. Generated diagnostics exclude PRIVATE_INPUT; no success terminal is accepted. Existing148tests remain green, including11Claude session/reuse/disconnect fixtures and previous native/terminal/EOF/error/stall coverage.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed:154tests/15groups pass,0failed/ignored;fmt andclippy warnings-as-errors pass;43project contracts,6llms files anddiff pass. Full suite passed on the first run after focused GREEN; no unchanged failure rerun. Independent source review and final documentation readback PASS with no blocking rework. Required CI/merge/readback remain publication gates.

Limits: the bound includes data/field prefixes andCR, excludesLF, and applies to ignored/comment lines too. LF/CRLF and existing lossy UTF-8/EOF behavior are preserved; this does not add fullSSEmultiline/CR-only parsing. Native Responses retains its separate16MiB event guard, and opaque streams retain raw bytes. Transport-owned chunks, converter accumulated output/tool arguments, output aggregation, collector buffers and allocator overhead are not bounded by this line limit. Execution remains consumer-poll-driven; no new background deadline/session/cancellation policy. HTTP coverage uses Chat/Responses sources; Anthropic-source paths are adapter-covered. No realprovider/Docker/login, newdependency/permission, release or whole-product acceptance.

Next separately scoped step: assess accumulated converter output/tool-argument bounds; not started by this slice.
