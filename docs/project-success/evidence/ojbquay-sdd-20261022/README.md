# T-0368 Ojbquay SDD evidence

This is evidence for a proposed reconstructed mainline SDD, not a usable-version qualification.
See systems/ojbquay/docs/test-reports/mainline-sdd-20261022.md for the AC matrix and exact search limits.

- active-repository-coverage.json:10 active repos; listing62 plus empty second page. Private raw scans remain in owner-retained T-0368 backup.
- unindexed-search/:full public tree/document manifests for Zircon-Godot and magpie, independent T-451 report and byte/digest validation.
- reference-build/:unchanged main0aac18413a3b39043706f17b8e5f801f41573d70 commands/logs/test cases.119 Java tests PASS; Go import FAIL;5 frontend tests/build PASS; initial missing-config deployment check FAIL and configured PASS. Default payload fixtures only; operator paths redacted.
- prior-strict-failure.json:retained preceding repair candidate132 tests131 PASS/1 FAIL703ms/0skip, later20 focused PASS is a different source. No old evidence overwritten.

No runtime, test, dependency, CI, retry anchor, warmup or threshold edits. No product PR/merge/tag acceptance follows from a document PR. usable_tag:none; owner acceptance pending.
Independent final SDD review and CI results are recorded in the PR and .team/reports/T-0368-ojbquay-sdd-review.md.

Accounting: prior/cross-compaction outer/nested/provider/retry and elapsed totals unknown/null. Current native agents2 (search and independent SDD review), not provider requests. Search worker reports210 read-only GitHub GET/0 API retry; parent totals incomplete and remain unknown. Sandbox bwrap initialization failed; specific commands used reviewed escalation without policy edits. No hard call limit was enabled.

Publication check caught trailing whitespace in three derived build logs before commit; only whitespace was normalized, while original complete raw logs remain in owner-retained backup. The initial staged diff-check failure was retained as a publication formatting failure, not a changed test result.
