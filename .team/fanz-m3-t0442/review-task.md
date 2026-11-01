ROLE: WORKER
AGENT: fresh-context native reviewer
ID: T-302
Goal: independently audit CU-M3-01–05 implementation and document contract; later inspect actual restart evidence without executing it.
Why: product persistence must not create a second dispatch authority or bypass auth on replay.
Inputs to read first: AGENTS.md; platform/fanzloud/AGENTS.md; docs/specs/SPEC-M3-durable-intents.md under that component; current diff, store/gateway/Web tests, parent evidence .local/fanz-m3-20261101/{store-report.md,web-red.log,web-green.log,gateway-red.log,gateway-tests.log,rust-check.log}; SDD FN04 minimum and M2 evidence boundaries.
Scope (may touch): read-only <workspace>/wt/newclear/fanz-m3-20261101 and listed evidence; write only <workspace>/.local/fanz-m3-20261101/code-review.md.
Out of scope (must not touch): all production/test/docs files, Git writes/network, provider/VM/browser/API calls, tests/build reruns, delegation. Existing M1/M2 dirty worktrees untouched.
Definition of done:
- [ ] Check durable-before-POST, concurrent duplicate/changed-key/unknown gates, loss/crash ordering, auth/CSRF/private paths, run/result immutable reference, bounded replay and UI recovery/races.
- [ ] Check docs match actual minimum slice; do not claim full FN04 event stream/FN05/FN07 or full M3.
- [ ] Report concrete blocking findings or ACCEPT_CODE; actual process/browser acceptance remains pending until its receipts arrive.
Verify with: read actual diff, source and retained test evidence; targeted read-only metadata/hash inspection if helpful; no unchanged-green test rerun.
Budget:20active minutes code audit, maxone focused correction follow-up; later10minute actual evidence follow-up within same assigned slice. No recursive agents. Provider requests/tokens/cost unknown.
