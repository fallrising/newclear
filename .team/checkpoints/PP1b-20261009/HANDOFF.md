# PP1b owner checkpoint — 2026-10-09

**Unfinished / not VERIFIED.** Owner requested a stopping point before VPS maintenance. This commit preserves implementation and reports; it does not pass missing acceptance gates. Latest approved specification is main e3d0c3fb (PR331); PP1a local runtime previously accepted by PR327. Full BW6 remains DOC_READY.

## Saved work

Formal account initialization/recovery core and local fresh-init maintenance wrapper, Q25 backend confirmation/self-protection, minimal client/admin UI, tests, guarded target/probe and initialized-account verifier, and account browser fixture. G06 source independent review passed. E01 parser four cases passed; no live account browser success yet. Known check outcomes are in STATE.json; reports and selected evidence contain scoped source hashes. The published Git commit binds the complete saved source tree. Earlier W5/BW6/BW1a records remain unchanged.

## Resume

1. Fetch the published branch and compare commit/file hashes. Read approved docs/v2/waves/PP1b.md and contracts/PP1-accounts.md plus this checkpoint and the separate PP1c draft branch.
2. Preserve all old worktrees, reports, snapshots, private local/pp1 trees, Docker volumes, images and keys. Git is not a backup of these local runtime data. Take a protected off-VPS snapshot before deleting/rebuilding the VPS; this agent has not made or verified such a copy.
3. Recheck host/Node24/JDK25/PG16/Docker tools and free capacity. All three newly owned runs were stopped; no volumes removed. The success candidate was prepared but never initialized. Do not reuse failed runs or clear retained maintenance locks.
4. Create a new isolated run with matched source/image/JAR artifacts for pending G07 success/negative checks. Keep fresh-init password in root memory through initialized verifier and the one-use browser credential socket. Never persist password in argv/env/log/artifact. G06 approved one-shot Java child environment is the explicitly bounded transport exception.
5. Execute initialized aggregate SQL and rollback-only same-count graph negatives before any login. Then run trusted accounts browser fixture against the same run. List/parser success is not browser acceptance.
6. After complete independent review and necessary CI, promote the implementation PR and merge normally. Do not mark PP1b or all BW6 VERIFIED while these are pending.
7. Correct the separate PP1c DRAFT contract against ROOT-REWORK and T004 findings, independently review, run docs CI and merge before backup/restore implementation. Upgrade recovery, scheduling/offsite copy/notifications and formal-environment acceptance remain later required work.

The old jar was built from e3d0c3fb plus uncommitted implementation bytes: SHA256 b16d6737cdf9dee82ca390ae0d88afe4b022c6238d6ef85c66d4c1e67f02f5e3; image sha256:fe48cc62f4f31748793c8d1f0b11845a645a7310c7fcb1b0ba77436fa5c3a986. Its labels do not claim this checkpoint commit. Rebuild or explicitly rebind evidence after a new source commit; do not silently substitute artifacts into an existing owned run.

Only selected nonsecret evidence is copied here; local-evidence-index.json gives original artifact hashes. Reports are historical snapshots: later STATE.json and this handoff supersede stale in-progress entries in PLAN.md. Provider/tool totals remain unknown/null. No deployment, destructive cleanup, runtime dependency or permission expansion was performed.
