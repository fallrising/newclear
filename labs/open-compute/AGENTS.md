# open-compute lab engineering rules

Follow the repository-wide instructions and the scope of the current task.

## Scope

This component evaluates a pinned upstream runtime with a small first-party
operational harness. Read `docs/SDD.md` before editing. Changes to the contract
precede implementation changes; keep acceptance IDs traceable to evidence.

- Use the original release artifact and verify its SHA256 before execution.
  Do not patch upstream, impersonate a non-root user, or use upstream test-only
  environment overrides to make a black-box test pass.
- M1 uses Linux x64, a non-root account, a fresh owned scope, loopback listeners,
  and the checked-in synthetic Worker. Never adopt or erase a scope that existed
  before this invocation; restart only the scope created by the current run.
- Keep harness dependencies in Python's standard library. A new dependency
  needs a concrete missing capability and an accompanying SDD decision.
- Keep subprocesses, network calls, response sizes, logs, and polling bounded.
  Credentials belong in restricted files or HTTP headers, never evidence or argv.
- A mock can verify the harness; only the real-runtime gate can verify upstream
  behavior. Record command, source identity, result, and environment limitations.
- A normal daemon restart is not a crash test, complete backup restore, HA,
  universal Cloudflare compatibility, or an untrusted-code security boundary.
- Keep public documentation self-contained and free of private infrastructure
  identifiers. Describe host authority, workload authority, and runtime contracts
  abstractly.

## Verification and evidence

The implementation supplies `make check` for local offline checks and
`make integration` for the real non-root runtime. Link the current evidence from
`docs/STATUS.md`; the quickstart is the single operator path. Add tests for
meaningful failure boundaries rather than duplicating implementation text.
