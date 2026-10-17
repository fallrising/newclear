# open-compute lab engineering rules

Follow the repository-wide instructions and the scope of the current task.

## Scope

This component evaluates a pinned upstream runtime with a small first-party
operational harness. Read `docs/SDD.md` before editing. Changes to the contract
precede implementation changes; keep acceptance IDs traceable to evidence.
For complete Local cold restore, also read `docs/SDD-M2.md`; its baseline must
be committed before M2 implementation.
For process-tree observations, also read `docs/SDD-M3.md`; keep its fixed workload,
identity generation, sampling limits and sanitized schema traceable to evidence.
For cold disk observations, read `docs/SDD-M4.md`; retain fixed D1 workload,
cold locks, metadata accounting, bounded owner checks and strict projection.

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
- M2 restores only the complete backup of this invocation's synthetic scope,
  after verified quiescence and actual source removal. Preserve the documented
  same-runner/path/UID boundary; never reseed missing state or upload backups.
- M3 observes only the owned runtime's four fixed idle/read windows across normal
  restart. Sampled aggregate RSS can count shared pages repeatedly; observed CPU
  pairs omit missing intervals. Never label either as complete capacity evidence.
- M4 observes three cold regular-file metadata endpoints, including derived OCR
  and transient content. Deduplicate observed inode aliases; distinguish logical
  bytes from reported allocated blocks. Directory/socket blocks and physical
  extent sharing are unknown; no capacity, growth-rate or per-row cost claim.
- Keep public documentation self-contained and free of private infrastructure
  identifiers. Describe host authority, workload authority, and runtime contracts
  abstractly.

For checkpoint SIGKILL, read `docs/SDD-M5.md` before editing. Keep per-generation
daemon-first signals separate from graceful shutdown, require the exact verified
crash receipt before restart and GET-only original state before approval.
Every frozen live target must itself receive SIGKILL; parent-loss disappearance
is failure. Sequential observed generations do not prove power-loss durability.

## Verification and evidence

The implementation supplies `make check` for local offline checks,
`make integration` for the M1 real-runtime restart, and `make integration-restore`
for the M2 real-runtime cold restore, `make integration-resources` for M3,
and `make integration-storage` for M4 on a separate fresh runner, plus
`make integration-crash` for M5 on another fresh non-root runner.
Link the current evidence from
`docs/STATUS.md`; the quickstart is the single operator path. Add tests for
meaningful failure boundaries rather than duplicating implementation text.

For controlled callback failures, read `docs/SDD-M6.md` before editing. M6 uses
`retry.py`, `retry_contract.py` and a separate fixed `fixtures/retry_worker.js`.
Run `make integration-retry` on a fresh non-root runner. Record independent
callback entries and post-effect acknowledgements; public attempt/config fields
are placeholders. Keep strict ordered cases, finite deadlines/GET budgets and
normal owned cleanup. Synthetic keyed D1 effects do not prove external exactly-once
behavior or crash safety. Preserve the original fixture and all historical reports.

For retained manual trials, read `docs/SDD-M7.md` before editing. M7 alone may
resume its exact prior initialized scope with a matching private manifest and
verified clean shutdown receipt. This exception does not change M1–M6's disposable
no-adoption rules. Use `trial.py` with a foreground owner and finite private Unix
clients; never detach it or present it as a system service. Stop retains data;
only explicit cold `destroy` may remove that exact scope. Dirty, incomplete or
uncertain Workflow authority refuses resume/disposal. Run `make integration-trial`
on a separate fresh non-root runner. Keep host installation and long-running
reliability claims outside this lab/CI milestone.
