# M3-U isolated-copy validator acceptance

Status: accepted (diagnostic-tool source and synthetic acceptance). Scope: COPY01–04 in
[SPEC-M3-COPY-VALIDATION](../specs/SPEC-M3-copy-validation.md).
Base `462f392ffb8299ff10aedde05f6c16e62095a7d9`; owner continuation after PR1081/1083.
Original private-copy execution NOT_RUN. Original FN07/fullM3/mainline incomplete and
usable_tag none remain unchanged. No original source/config/SQLite/credentials or
AP product source/schema/runtime was changed.

## Actual verification

- `python3 -m unittest discover -s platform/fanzloud/acceptance/owner-data-recovery -v`:
  29tests pass, including17 inherited snapshot tests and12 new staging/reference/
  comparison/boundary/cleanup/CLI tests. No private candidate is used.
- Existing cached Ruff0.17.1 format/check on the three new Python files: pass after
  import/literal/format cleanup. Broad CLI/DB exception boundaries are deliberately
  retained with fixed public output and private diagnostics; no credential leaks.
- `python3 -m py_compile` on the three new files and `git diff --check`: pass.
- Real synthetic PostgreSQL18.6 at original pinned digest: exact logical comparison,
  unchanged AP schema/migration/quiescence guards, read-only write rejection, launch
  inspection and confirmed cleanup pass. Autonomous deadline observed120.53s/exit137,
  with no host stop before the observed exit; source archive hash unchanged.
  Final-version rerun also passed120.53s/exit137. [Sanitized smoke](evidence/M3-copy-validation/synthetic-smoke.json),
  [28tests](evidence/M3-copy-validation/unit-green.txt), [behavioral RED](evidence/M3-copy-validation/behavior-red.txt)
  and [that smoke source](evidence/M3-copy-validation/synthetic-smoke-source-sha256.json) retain exact evidence.
  The later review correction has its own [source hashes](evidence/M3-copy-validation/source-sha256.json)
  and [29test result](evidence/M3-copy-validation/outcome-green.txt).
- Fanzloud `PATH=/tmp/fanzloud-p01-checks/bin:$PATH python3 scripts/check_indexes.py`:
  55project contracts and9llms indexes pass. Staged whitespace/alignment pass.
- Fresh-context independent review: ACCEPT after one P2 persistence correction.
  Reviewer independently ran29tests and the three-case CLI fault matrix, verified
  source hashes/whitespace and inspected completed synthetic evidence.
- Hosted CI/merge/readback pending; BOARD owns delivery state.

## Failure history and limits

Test skeleton first failed missing module. Minimal behavioral stubs then failed4of6
cases; this is the behavioral RED. Initial implementation passed23tests, later boundary
coverage passed28. Synthetic seed's pg_ctl exec initially returned an ambiguous error
as container PID1 exited; the fixture now requires observed stopped/exit0 and removed
PID file before accepting that race. The production cleanup always independently
inspects stopped state and never treats a failed stop as success. This fixture issue
is retained in the private packet; it is not a private-data failure.

The workspace-root `python3 scripts/validate_repository.py` also scanned unrelated,
untracked worktrees and private runtime folders, producing13115issues. This is an
out-of-scope workspace publication scan, not a clean result. A clean export of that
root repository's tracked HEAD passed18studies/712Markdown files; the changed repository's own
required55project/9llms index gates and Fanzloud CI remain mandatory. No unrelated
runtime files are removed or exposed to satisfy a publication-tree validator.

Tool delivery establishes a reviewed way to ask the data question. It does not prove
original locale/extension/startup compatibility, committed rows, full archives,
current-source UI/binary readiness, TLS/trust, owner connectivity or actual FN07.
The existing [recovery proposal](M3-owner-data-recovery.md) requires separate approval
for the concrete private-copy run after review. No original PostgreSQL service,
original writable volume, provider/VM or command replay occurred in this development.

Independent review initially REQUEST_CHANGES (P2): if diagnostics/outcome persistence
failed after cleanup was unknown, the generic CLI fallback could downgrade the result
to not_ready. [Three behavioral RED subcases](evidence/M3-copy-validation/outcome-red.txt)
reproduced it. The correction isolates private diagnostic-write failures, preserves
outcome_unknown/cleanup_unconfirmed with receipt_persisted=false, and refuses a verified
result without a durable outcome. All29tests and Ruff pass; focused re-review ACCEPT.
No runtime isolation, deadline, SQL or comparison condition was weakened.

Final corrected-source [synthetic integration](evidence/M3-copy-validation/accepted-synthetic-smoke.json)
passed again: all seven logical checks, read-only write rejection, persisted outcome,
confirmed cleanup, unchanged source and autonomous120.48s/exit137. Python3.12.3,
psycopg3.3.6 and the exact PostgreSQL18.6 image. Both prior smoke bindings remain
historical and are not substituted for this corrected-source evidence.

Post-test inventory:112original volume names unchanged, zero task-owned containers
remaining; [sanitized cleanup](evidence/M3-copy-validation/cleanup.json). No original
volume was mounted by these tests. The fixed image is retained as the proposed
execution prerequisite. Private logs/fixtures are retained separately, never in Git.
The changed Markdown paths had173relative links with no missing targets before final
receipt links were added; final precommit recheck is recorded in the delivery ledger.
