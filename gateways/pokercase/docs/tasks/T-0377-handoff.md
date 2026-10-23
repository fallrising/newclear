# T-0377 Cursor isolation handoff — 2026-10-23

Status: implementation retained for review; **not accepted or ready to merge**. Cursor remains in scope. Specification PR #563 merged.

Implemented Docker-only runner, pinned local image, dedicated profile volume, no host fallback, resource limits, fixed error messages and bounded cancellation cleanup. Independent review corrected the startup cleanup ordering; late daemon creation beyond the bounded window remains an operator reconciliation concern.

Verification from cursor-isolation worktree (CARGO_TARGET_DIR reused from pokercase-hardening):
- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`: PASS after cleanup fix; all suites passed.
- `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings`: FAIL, Commands enum large_enum_variant at src/main.rs:47 after adding flags. Fix structure without suppressing validation.
- `python3 scripts/check_project_success.py`: PASS, 42 contracts.
- `python3 scripts/check_indexes.py`: PASS.
- `git diff --check`: PASS.
- `scripts/verify_cursor_container.py --binary <target>/debug/thinrouter --base-image python:3.14-alpine`: FAIL, first completion HTTP 502. Full gateway canary remains unresolved. Running the same fake executable directly in a restricted Docker container returned the expected UID/filesystem/env/socket checks, which does **not** establish gateway acceptance.
- Independent review: original cleanup ordering blocker resolved; regression covers late-creation helper, not full startup cancellation integration.

Next: diagnose actual gateway canary 502; fix enum lint; rerun relevant tests and clippy, complete success/error/cancellation Docker probe, then independent acceptance and required CI before normal merge. Real Cursor image recipe/login/provider roundtrip is unverified; no real credential or model call occurred. Do not claim product or isolation completion.

Round started 16:57:52Z; 20-minute cutoff17:17:52Z; final3minutes reserved for handoff. Logs and review retained in worktree .team and workspace .local/t0377-cursor-isolation. Provider request counts/token cost unknown; no paid provider probe initiated.
