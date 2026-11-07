ROLE: WORKER
AGENT: native inherited
ID: T-442
Goal: Fix reviewer R2 backup admission for exact legal subscription terminal histories in M2.
Why: Additive backend must not break native backup contract; preserve unresolved-cleanup refusal.
Inputs to read first: main .team/fanz-m2-t0442/review-report.md R2; own cancellation.py, backup.py and test_backup.py. Parent copied measured migration020 schema pin into your backup.py.
Scope (may touch): ONLY /home/ckc/test/codex/wt/newclear/fanz-m2-routing-20261101/platform/agent-platform/src/agent_platform/backup.py and tests_platform/test_backup.py; own .team/fanz-m2-t0442/backup-report.md.
Out of scope (must not touch): Other files, parent tree, runtime/provider/VM calls, Docker, new dependencies, Git mutations, recursive delegation. No M3 persistence redesign.
Definition of done:
- [ ] Admit exact never-allocated queued cancellation gen1 only with matching done job gen, zero attempts/no lease/no adapter operations/bindings, completed matching cancellation command and timestamps/reason; retain generation0 path and negative altered/missing-proof cases.
- [ ] Confirmed cocoon-local bindings accept both subscription backends with all existing generation/provider-handle/released-reservation proof.
- [ ] Real PostgreSQL native roundtrip fixtures cover each backend's queued cancelled and confirmed terminal histories; explicitly mock runtime only, native backup/restore remains real. Include missing cleanup/intent negative regressions.
- [ ] Report changes and tests/limits. No weakened fingerprint or safety checks.
Verify with: Existing native-venv ruff, compileall for own modified files; parent runs actual PostgreSQL focused tests. Test definitions should use established fixtures.
Budget:15min active, max2 justified fixes for same issue; no subagents. No provider executions; token/cost unknown.
