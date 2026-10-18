STATUS: PARTIAL

Issue: https://github.com/fallrising/newclear/issues/346
Component: tools/codex-usage
Task: [task.md](task.md)
Delivery PR: https://github.com/fallrising/newclear/pull/347 (opened as draft; Refs #346)

## Summary

README and quickstart now explain offline evidence, provide a delivery report example, and distinguish local
checks, hosted CI, independent review, and live acceptance. Local native checks pass. Hosted CI, root scope
review, independent review, and ready/merge transitions remain pending with the orchestrator.
The collector remains offline-tested / live-unverified; no account snapshot was collected.

## Verification

- From `tools/codex-usage`: `python3 -m unittest discover -s tests -v`; 17 tests passed, exit 0. Retained log reference: `offline-unittest.log`, outside the public source tree — passed
- From `tools/codex-usage`: `python3 -m py_compile codex_usage.py`; exit 0. Retained log reference: `py-compile.log`, outside the public source tree — passed
- Repository root: `git diff --check`; exit 0. Manual relative-link, bounded scope, public additions, Refs and lifecycle review; retained reference: `documentation-checks.json` — passed
- Hosted component CI: required by task; not run by this offline worker. Orchestrator must record the actual hosted run and result — skipped
- Root scope review and independent review: pending orchestrator gates; worker inspection does not establish their completion — skipped

Native checks used the configured shared workspace launcher. Log references name retained artifacts;
they are not links to files committed in this repository. The orchestrator retains run records separately
and must provide sanitized public evidence or an abstract reference when completing delivery review.

## Documentation

Updated [README](../../README.md#reporting-evidence) and
[quickstart](../../docs/quickstart.md#delivery-report-example). Checked the documentation and reporting
criteria in [task.md](task.md); delivery criteria remain unchecked. Additions contain no private paths,
authorization contents, account data, or private links.

## Risks and Follow-ups

Record hosted CI, root scope review, and independent review before changing this report to DONE or marking
the PR ready for normal merge. Required skipped checks prevent DONE. Live CLI version, account/workspace,
App Server schema, real snapshot, and usage comparison remain unverified and outside this documentation scope.
This report records evidence rather than a second GitHub lifecycle. Merge delivers the change;
the issue stays open until the owner records acceptance and closes it.

## Orchestrator pre-merge checkpoint

The preceding worker checkpoint is historical. Root reproduced all 17 offline tests and compilation,
reviewed the four-file scope and public additions, and checked 18 relative links outside fenced examples.
Independent review found no blocking issue. Sanitized evidence references are `root-public-native/offline-tests`,
`root-public-compile/compile` and `root-public-pilot-docs2/docs`; these name retained logs and exit/hash receipts,
not repository files or live account evidence.

- Root offline tests, compilation and scoped public documentation review — passed
- Independent diff/evidence review by a separate reviewer — passed
- Hosted component CI on `620789c6523ca22a5150d620c78e4e93d64ba6e1`: [run 38247787573](https://github.com/fallrising/newclear/actions/runs/38247787573), test job success; trailer run 38247787774 also succeeded — passed

This pre-merge report remains PARTIAL only for final report-commit checks and the delivery transition.
The PR and issue carry the final head checks and merge receipt; local evidence does not imply live acceptance.

### Pilot friction and handoff

GitHub needs a branch diff before opening a draft PR, so this pilot committed the complete task scope and
an honest pending report first, then opened the draft and added implementation/evidence. Assignment metadata
was updated manually; it was not tested as an exclusive lock. A report committed inside its own delivery PR
cannot truthfully contain that future merge receipt: this file is the pre-merge snapshot, while the linked PR
and issue record the post-merge delivery evidence. Owner acceptance stays separate; only the owner closes
the issue. No later phase starts from this delivery.
