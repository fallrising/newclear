# T-0385 — Cursor terminal errors

Demand: [desk T-0385](https://github.com/fallrising/desk/tree/main/tasks/T-0385-thinrouter-cursor-errors). Scope and fixed CE-1–CE-3: [SUCCESS](../../SUCCESS.md#t-0385--cursor-terminal-failure-handling).

Started 2026-10-24T07:35Z (approximate); claimed by codex-gpt6-pilot. Expected active effort25minutes; 20minute progress checkpoints; CI bounded10minutes per wait. Initial reproduction plus at most two reasoned fixes per failure. Hosted tokens/tool totals/model requests/cost unknown. Product live calls0 planned.

Status: implementation, local checks and independent review complete (2026-10-24T07:44:30Z). Remote CI and merge are publication gates; final readback is recorded in the linked desk/journal record. First write the failing protocol regression, then minimal translator fix, native checks, independent review and normal PR merge/readback. Preserve old failures and all prior live evidence. Board end time records local implementation completion; merge status is separately linked here.


## Evidence (2026-10-24)

Base source: `7cee5a240cbb30e6e6932bb98efd0ba10a4f93d4`. Product changes are limited to the Cursor result validator and regression fixtures. A failed terminal event cannot be rescued by a later success. Raw result/stderr text is never copied into the fixed failure message.

| AC | Observed evidence | Result |
| --- | --- | --- |
| CE-1 | `ce1_failed_cursor_result_before_output_is_redacted` across three APIs, streaming and non-streaming; `ce1_only_a_documented_success_result_can_complete` covers malformed/missing fields, conflicting flags and terminal finality | PASS |
| CE-2 | `ce2_failed_cursor_result_after_output_is_not_success`, `ce2_cursor_eof_after_output_is_not_success`: three APIs, buffered failure versus already-started SSE error, no successful terminal event, named-container cleanup | PASS |
| CE-3 | Existing text/deduplication/usage tests; all103 Rust tests; real Docker fake-CLI canary with documented success fixture | PASS |

Exact commands, from repository root (shared `CARGO_TARGET_DIR=/home/ckc/test/codex/wt/newclear/pokercase-hardening/gateways/pokercase/target` on cargo test/clippy):

- RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test cursor_cli_e2e ce1_failed_cursor_result_before_output_is_redacted` failed as intended: error payload became assistant content with `finish_reason: stop`.
- First focused run after fix: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test cursor_cli_e2e`:7passed/2failed. The two new CE-2 assertions incorrectly expected top-level `error` in Responses SSE. Actual output already had `type:error` and `response.failed`; test corrected to require its proper message/error fields without changing product output.
- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`:103passed/0failed; includes all9 Cursor gateway tests. Four new tests versus prior99.
- `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check`:PASS.
- `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings`:PASS.
- `python3 scripts/check_project_success.py`:42contracts PASS; `python3 scripts/check_indexes.py`:PASS.
- `python3 gateways/pokercase/scripts/verify_cursor_container.py --binary /home/ckc/test/codex/wt/newclear/pokercase-hardening/gateways/pokercase/target/debug/thinrouter --base-image python:3.14-alpine`:PASS host read/write/env/socket denial, readonly rootfs, UID1000, workspace write, success/error/cancel cleanup. Reviewer found the old success fixture omitted subtype/is_error; it now follows the documented shape.
- `git diff --check`:PASS; staged whitespace gate required before commit.

Local compact evidence: `/home/ckc/test/codex/.local/t0385-cursor-errors/` (`red.log`, `focused.log`, `tests.log`, `clippy.log`, `canary.log`, independent `review.md`). Official contract reference: https://cursor.com/docs/cli/reference/output-format (checked2026-10-24). Error-shaped result fixtures exercise defensive validation, not a claim of a captured official CLI incident.

No real account, provider request or login was used. A stream that has already sent headers retains HTTP200 and reports failure in protocol events. Existing stream usage logging records admission status; this patch does not reinterpret it as final inference success. Full product acceptance and live client/tool/image/lifecycle matrix remain pending. No release/deploy.

Independent review: PASS after both the Responses-test assertion and canary fixture findings were corrected; no remaining blocker. Root evidence gate accepts CE-1–CE-3 local delivery. Source/review logs and historical failures retained; remote checks must pass before merge.
