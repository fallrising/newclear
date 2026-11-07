STATUS: DONE

## Summary

ACCEPT for the bounded local implementation review of T-0446 M7. No unresolved must-fix findings. Necessary remote CI, merge/readback and ledger delivery remain separate orchestrator work.

Reviewed the diff against `276df71a3e874b142efc53b11f9c98d009d668c4`, including both initially untracked test files, the milestone and user documentation. Applied the existing `codex-task-worker` and `codex-evidence-gate` contracts. Only this review report was edited; no implementation changes, Git/remote mutations, dependencies or delegation.

N-01: The shared `source_node` helper matches exact IDs only and requires exactly one match. CLI and MCP call the same helper inside the existing live snapshot boundary and return matching five-field provenance. The real same-file Alpha/Beta fixture resolves the two `.run()` nodes to their distinct IDs, lines and bounded contents. Existing label-based readers retain ambiguity rejection.

N-02: Option validation rejects empty IDs, non-integer/bool/out-of-range line counts and invalid expected-index formats. CLI validates syntax before opening an index/cache. A valid mismatched index is checked before reading source content, while documentation correctly permits opening the current index first. Unknown IDs, label-as-ID, duplicate selected IDs, escaping source pointers, unsupported locations and out-of-file lines are rejected. IDs are never interpreted as filesystem paths. The existing canonical-path, symlink and line-boundary reader is reused unchanged.

N-03: Both surfaces use `LiveWorkspace.execute` before/after validation. CLI builds or selects the current index for each invocation; MCP remains stale until explicit refresh. A surviving node ID cannot bypass an old expected-index guard. Successful and failing callback races discard stale content and old diagnostics. The real stdio journey establishes path-result ID selection, both source excerpts, old-reader rejection, validation errors, stale refusal, explicit refresh, old-index mismatch and guarded updated content.

Compatibility: The only existing reader/algorithm dispatch change is the new `source-node` branch and allowing its result shape to omit an analysis status field. Existing calls-path/impact exits and old source/serve behavior remain covered by the full suite. Seven-tool documentation and tool-list assertions agree with the new MCP surface.

## Verification

Lab commands run from `labs/graphify-lab`; root commands are identified. Artifact paths below are relative to the lab unless otherwise stated.

- Reviewer executed `timeout 120 .venv/bin/python -m unittest discover -s tests -p 'test_node_source*.py' -v` with authorized escalation for real stdio: 9 tests in 12.036 seconds, OK; N-03 reports 15 requests including initialize/list — passed
- Inspected `timeout 300 make check` output, retained as `docs/evidence/node-source/tests.txt`: 109 tests in 60.467 seconds, OK; original 100 plus new nine, including M4/M5/M7 real stdio journeys — passed
- Inspected `work/m7-full/report.json`: seven scenarios passed, zero failed; reviewer compared all 23 input SHA256 entries with current file bytes and found no mismatches — passed
- Inspected `work/m7-pilot/report.json` and `work/m7-workspace/report.json`: both status passed; ten pilot command exits and thirteen workspace command exits are all zero — passed
- Inspected durable `docs/evidence/node-source/regressions.json`: full/pilot/workspace statuses agree with the raw reports and include report digests — passed
- Inspected root `python3 scripts/check_indexes.py` output: 47 project contracts/navigation, eight llms.txt files, zero errors — passed
- Inspected root `ACTIONLINT_CACHE_DIR=<scratch> python3 .github/scripts/check_workflows.py` output, with local scratch path normalized: actionlint 1.7.12, 40 workflows — passed
- Reviewer executed `git diff --check` and `git diff --cached --check`: both exit 0 — passed
- Read back final evidence README and scanned the evidence directory for home/temp absolute paths and credential markers: no matches after the documentation correction — passed

## Documentation

The specification defines N-01 through N-04, exact-ID semantics, optional index preconditions, response envelopes and error behavior. User documentation distinguishes current-snapshot guards from historical graph loading and warns that IDs do not promise stable semantic identity across revisions. The evidence README accurately describes actual extraction/CLI/stdio tests, adversarial rejection-only metadata, race coverage and unknown provider metrics.

One minor finding was corrected by the orchestrator: the evidence README's workflow command included an absolute local scratch-cache path. It now uses `<scratch>`, matching the component's evidence privacy rule. No runtime fix was requested.

## Risks and Follow-ups

Historical failures remain explicit. The initial missing-helper import RED is preserved. The first new MCP test incorrectly accessed the existing calls-path result as `nodes` instead of `path`; the focused run failed, and the already-running full suite failed with the same KeyError. Reviewer inspected both failure logs and the corrected test. Only the test expectation changed; the existing calls-path contract was not weakened. Corrected focused and full suites subsequently passed. The initial navigation gate failed because the new specification was untracked; staging the intended document resolved the checker input issue, and the retained final navigation output passes.

No required local check is currently failed or skipped. Acceptance does not erase those earlier failed executions or claim they were successful. Remote CI, PR merge/readback, board closure and desk/journal synchronization remain pending parent-owned steps.

Freshness is observational, without an external-editor filesystem lock. The index guard compares the current valid snapshot and never loads an old graph. Static extraction may omit relationships, and returned source metadata should still be reviewed before publication. No dependencies, parser/graph algorithms, source execution, release/deployment or next-milestone scope were added. Complete tool/provider totals, tokens, cost and precise active/wait split remain unknown/null; 15 MCP requests are not provider usage.
