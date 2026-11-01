STATUS: DONE

## Summary

Completed the bounded M1 FN-06 Rust gateway cancellation route in the root integrated tree. Only `POST /api/v1/runs/{canonical UUID}/actions` is added. Before forwarding, the body must be a JSON object containing exactly `action: "cancel"` and integer `expected_state_version` in 1..9223372036854775807. Other actions, duplicate/extra/missing fields, arrays, trailing values, nonintegers and overflow are rejected. Existing bounded body/framing, exact Origin, operator header forwarding and mutation-unknown/no-retry handling remain shared.

Frozen source SHA-256: `ee2101bb4c1a35a4c21aaa182e6a6cb4d53dd1e3b7c5cf4fc5030f0e2f4f9197`.
Changed source: `platform/fanzloud/apps/control-plane/src/isolated.rs` only; this report is the other assigned write. No provider, VM, remote, dependency or Git mutation occurred.

## Verification

All commands below ran from `$WORKTREE` with the pinned Rust 1.97.1 toolchain.

- RED: `cargo +1.97.1 test --locked --manifest-path platform/fanzloud/Cargo.toml -p codebox-control-plane isolated_cancel_route_is_exact --lib` — expected failed before implementation (exit 101, assertion `allowed(&Method::POST, path)`), establishing the missing route. Resolved by the subsequent GREEN run.
- GREEN: `cargo +1.97.1 test --locked --manifest-path platform/fanzloud/Cargo.toml -p codebox-control-plane isolated --lib` — passed, 10 tests, 0 failed, 37 unrelated tests filtered. Includes all seven existing gateway tests and three new focused cancellation tests. Real local TCP validates exact body and Cookie/CSRF/idempotency/Origin forwarding at both positive integer boundaries; a closed upstream verifies invalid bodies return 400 before transport.
- `cargo +1.97.1 clippy --locked --manifest-path platform/fanzloud/Cargo.toml -p codebox-control-plane --all-targets -- -D warnings` — passed.
- `cargo +1.97.1 fmt --manifest-path platform/fanzloud/Cargo.toml --all -- --check` — passed.
- `git diff --check -- platform/fanzloud/apps/control-plane/src/isolated.rs` — passed; scoped diff manually reviewed.

## Documentation

Implements root-owned `docs/specs/SPEC-M1-isolated-web.md` FN-06 completion addendum and `.team/fanz-executor-t0447/cancel-worker.md`. No broader product documentation is worker-owned.

## Risks and Follow-ups

These are source/unit/real TCP gateway contract results, not live cancellation proof. Root owns real Rust/AP queued cancellation without allocation, browser reason projection and final-source read-only replay against the existing successful diff. Authentication, CSRF verification, state-version fencing, idempotency and proof of actual stopping remain AP authorities. No additional AP action is exposed and unknown does not imply stopped.
