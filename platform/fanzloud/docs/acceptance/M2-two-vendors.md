# M2 second vendor and concurrent isolation — T-0442

Status at initial code checkpoint: **PARTIAL / live FN02 and concurrent FN03 NOT_RUN**.
[Normative scope](../specs/SPEC-M2-two-vendors.md), [independent review](../../../../.team/fanz-m2-t0442/review-report.md).
M1 is preserved at live33e1eb70 / final391aa1aa; no CloudAC04 or M3 acceptance is implied.

## Implemented call chain

Same private HTTPS Web → Rust gateway → AP catalog/task/run/result → matching
Claude or Codex subscription driver → existing run/generation-bound Connector tools
→ Cocoon VM. Official CLIs retain inference; AP alone owns allocation/leases/cleanup.
Codex app-server has empty thread/turn execution environments, isolated startup config,
pinned official CLI/model metadata, three dynamic VM tools and no uncertain relaunch.

## Evidence before live

- Official Codex0.166.0 binary SHA256
  `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`;
  source tag commit `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`.
  Model gpt-6.1-sol, unmodified catalog SHA256
  `7317e3d0e2d527e430c9604f2da589184a566d2c51974d74c29244f0abcfe915`.
- Actual CLI startup/config audit passed without a turn. Actual CLI plus local synthetic
  Responses provider denied nested host patch, Node/file imports, file media and unknown
  resources; no host marker, MCP empty, inert dynamic callback succeeded. **Mock provider,
  no vendor coding or VM acceptance.** Earlier unqualified/failing probes retained.
- Native adapter fake-process8 tests passed; startup route/config refusal before thread,
  exact callback binding, no-tool/failed turn refusal, watchdog and no second invocation.
- Web17 tests passed, including confirmed second submission versus unknown lock, delayed
  cancellation and pending/failing task selection. UI regression was observed RED first.
- Native PostgreSQL backup31 passed including both vendors' real dump/restore histories
  and negative proof mutations. Earlier failure exposed queued-cancel gen1 and missing
  subscription backend support; exact durable proof restored, validation not removed.
- Rust formatting, clippy, all workspace/all-target/all-feature tests and binaries passed;
  offline evidence parser3 and repository project-success50 passed.
- Independent review: original REWORK findings R1–R3 corrected, then ACCEPT_CODE.
  Full AP `make platform-check` passed lint/format,45 base tests and809 platform tests
  against a fresh real PostgreSQL instance; owned test container removed. Hosted CI pending.

Private raw evidence lives in the task's local handoff and eventual private backup;
only sanitized source/run/hash/check summaries belong here. Provider requests, aggregate
model tokens/cost and historical orchestration totals are unknown unless explicitly measured.
No resource expansion: one VM4CPU/4GiB, coding<=600s, zero warm; concurrent experiment
requires a separate explicit bounded approval. No standing operator URL or full MVP claim.


Commands at this checkpoint (component working directories):

```sh
# platform/agent-platform; retained locked native-venv, PYTHONPATH=src:tests_platform
make platform-check
python scripts/test-postgres.py python -m unittest test_backup -v
python -W error::ResourceWarning -m unittest test_subscription_codex -v
# platform/fanzloud
node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs acceptance/m2-isolated.test.mjs
python3 -m unittest discover -s tools -p 'test_m1*.py' -v
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets --all-features
cargo build --locked --workspace --bins --all-features
# repository root
python3 scripts/check_project_success.py
git diff --check
```
