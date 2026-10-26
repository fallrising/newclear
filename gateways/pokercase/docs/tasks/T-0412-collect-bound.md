# T-0412 Bounded response collection

Demand: [desk T-0412](https://github.com/fallrising/desk/tree/main/tasks/T-0412-thinrouter-collect-bound). Contract: [BC-1–BC-3](../../SUCCESS.md#t-0412--bounded-response-collection).

## Verification — 2026-10-25

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml bc2_oversized_first_record_closes_receiver -- --nocapture` failed because an oversized first CLI record waited for EOF instead of returning within the1s focused deadline. The sender remained open. Original RED retained; one implementation correction. Focused `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml bc -- --nocapture` passes all7newtests.

HTTP successful non-stream bodies now use a shared streaming collector: check actual chunk bytes before copying, cap the growth request at16MiB, preserve existing biased cancellation and read-error mapping. Content-Length is not consulted. Whole-body collection remains whole-body, including bytes after typed forced-SSE terminals. Exceeding the limit returns fixed502 `upstream response collection limit exceeded`; partial bytes and source are dropped before return.

Shared Claude/Cursor collection checks the first and subsequent records before retaining them. Each consumes UTF-8 bytes plus2separator bytes and one of65536entries; byte limit16MiB. Empty records still consume2bytes and an entry. On excess, the receiver and partial records are dropped before returning the same fixed502; existing producer receiver-closure handling stops active runs. Explicit CLI failure status/message, completed session reuse and existing usage/tool reassembly remain unchanged.

Added54scenario iterations across7tests:10HTTP byte boundaries (empty/small/limit-1/limit/limit+1 ×single/fragmented);3pre/mid cancellation and read-error cases;2record byte/entry budgets;8shared collector first/later/empty/UTF8/exact/over/explicit-failure cases;1original first-record regression;27actualHTTP cases (ChatJSON/ResponsesJSON/forcedSSE ×three clientAPIs ×small/exact/over);3active fakeClaude collection-limit/reaping/slot-reuse cases. These are matrix iterations, not54runner entries.

Unit source witnesses retain ownership even after returning None; assertions inspect destruction before result delivery. HTTP uses chunked bodies with no Content-Length and no EOF for oversize bodies; all27source-drop notifications are required. The27HTTP matrix passed in2.43s, with10s per-client timeout. FakeClaude overflows through allthree APIs then remains active; each failure must return within10s, its process must be reaped within3s, and a replacement request must succeed with one run slot. Observed1.72s for the three cases. This proves fakeprocess/sharedcollector integration, not real Cursor/Docker/provider cancellation. Existing fakeCursor regressions and Claude normal tool/session cases remain required gates.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Full native suite172tests/17groups,0failed/ignored;fmt/clippy warnings-as-errors,43project contracts/6llms indexes/0errors and diff check PASS. Existing165tests, including fakeCursor and Claude normal tool/session regressions, pass. Independent source/final-document review PASS with no blocking rework; required CI/merge/readback remain publication gates.

Limits: these are per-response retained input bounds, not total-RSS/allocator bounds. Transport chunks and CLI producer records/queues already exist before collection; parser/output expansion and the output JSON are not capped here. Non-success HTTP diagnostic/refresh bodies retain their existing reads. No framing/terminal classification/deadline/session/retry/accounting/dependency/permission/provider/login/release/deploy changes. Whole-product acceptance remains separate.

Next separately scoped step: assess remaining non-success HTTP diagnostic-body collection; not started.
