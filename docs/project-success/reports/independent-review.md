RECOMMENDATION: ACCEPT

## Scope and snapshot

Independent read-only review of newclear #440: all 39 SUCCESS contracts, README/AGENTS navigation, shared policy, inventory/index, checker/tests/workflow and four proposed usable qualifications. Final review: **2026-10-21 15:59:43 UTC**. No product implementation was edited by the reviewer.

Runtime baseline: `b97319d74f8442b5173ef42be72a0aa757d87df0`; qualification checkout: `d62cf11d722f229c3a048e4021282aa5783b976e`. Reviewed checkout HEAD was `3b966b0c216d59bd20671bedf7368671aba47b0a` plus the final documentation/qualification delta. Product runtime remains unchanged by this rollout. The 129-file reviewed snapshot digest is `4a56690963b672dff4ef21f5e0381a3a527f479b9ab07e77073fe3a32c1741ef`: sorted lines of relative path, space, SHA-256 and newline, covering component SUCCESS/README/AGENTS, root README/AGENTS/PROJECTS, policy/inventory, checker/tests/workflow and qualification Markdown.

## Findings and resolution

No blocking finding remains. Initial findings were corrected and independently rechecked:

- Qualification result/project/tag/source matching now requires exact unique fields, rejecting prefixes and conflicting duplicates.
- Inventory, SUCCESS and README/AGENTS paths reject traversal/noncanonical paths and outside symlinks before reading.
- New categories/components cannot silently escape discovery; exclusions are explicit and the lightweight gate runs on all PR/main changes.
- ojbquay's original 150 ms retry target and measured 206–253 ms failure are retained. Its mainline is incomplete and no tag is proposed.
- Index wording distinguishes incomplete implementation from missing qualification. Qualified-project text distinguishes fresh runs from historical evidence; operator paths in public evidence are sanitized.

## Qualification assessment

Four proposed tags are supported within their documented scopes:

| Project | Reviewed evidence | Scope |
| --- | --- | --- |
| DimGate | 426 native tests and static/build gates; four actual Chromium shell/Guide flows; historical full suites inherited only after exact unchanged runtime/test/package/config comparison | Local mock demo |
| ClarkQ | vet/test/build; six real demo scenarios and 49 assertions including restart persistence, authentication and quota | Recommended single-node queue |
| mkfk | Current format/vet/unit/race/model/integration/full-chaos and real three-broker demo; optional extended/performance history explicitly separated | Teaching distributed log |
| pg-jev-router | 15 unit and six real PostgreSQL/pg-jev integration tests plus nine routing cases | Synthetic-provider lab; no live LLM claim |

The accepted-to-current DimGate runtime, E2E, package/lock, Vite, Playwright and demo-environment Git diff was independently checked and empty. Current documentation/CI-script changes have fresh checks. Relevant mkfk changes are disclosed and required gates rerun instead of inheriting old results without evidence.

Wotar correctly withholds a tag after its required Ruff failure, certificate-dependent skips and deselected integrations. ojbquay's original timing gap remains a failed qualification. The [qualification report](qualification-newclear.md) retains PARTIAL status with exact successful, failed, skipped and inherited evidence; no failed candidate is relabeled usable.

## Verification

- `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` — passed, **15 tests**.
- `python3 scripts/check_project_success.py` — passed, **39 contracts and navigation/index**.
- `git diff --check` — passed.
- Isolated negative fixtures reproduced the original checker defects; final regression cases reject them — passed.
- Original specs, primary historical records, command JSON/logs and final qualification documents reviewed; final public-path sanitation scan — passed.

## Remaining delivery gates

ACCEPT covers the reviewed change and bounded local qualification decisions. Required PR CI, normal merge, final source equivalence, annotated tag creation and exact remote tag/peeled-commit readback remain necessary before reporting published usable versions. This review does not claim deployment or authorize new product implementation, production operations or paid calls.

## Final CI delta review — 2026-10-21 16:20 UTC

RECOMMENDATION: ACCEPT — readiness correction and CI evidence retention only.

**This dated addendum supersedes the earlier four-candidate qualification assessment above. mkfk is withdrawn; the current newclear set contains three proposed usable versions: DimGate, ClarkQ and pg-jev-router.** Earlier successful local mkfk runs remain historical observations and do not establish current qualification.

The independent reviewer checked the final uncommitted delta against `c0f49d40f8a401efd51b79a70867d0cf30eb0363`, including SUCCESS contracts, qualification/disposition records, PLAN/index and the mkfk workflow. No product runtime, seed selection, test oracle, timeout or workflow permissions changed. The workflow keeps its existing mandatory chaos command and failure behavior; its only change explicitly retains `chaos.log` and `chaos-report.json` from the hidden `.test-output` directory with `include-hidden-files: true`.

GitHub's run, attempt/job and artifacts APIs independently confirmed that [run 39631545715, attempt 1](https://github.com/fallrising/newclear/actions/runs/39631545715/attempts/1), at that exact commit, failed the required short-chaos step. The format/vet/unit/race/model/integration job and three-broker demo passed. The run's artifact count was zero. The missing seed/assertion evidence prevents a root-cause finding; a successful retry with a different seed cannot discharge the known failure.

mkfk now has `mainline: incomplete`, `usable_tag: none`, failed AC-04 and `RESULT: FAIL`. Its proposed tag is withdrawn in the index and both human-readable and machine-readable qualification dispositions. The machine-readable record preserves the initial local PASS and identifies the superseding failed CI attempt. The qualification report explicitly replaces its earlier four-PASS snapshot with three PASS and three unqualified candidates. Agent Platform's separately observed cleanup error is also retained in its incomplete SUCCESS contract; this review makes no claim that it was repaired.

Independent final delta checks:

- `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` — PASS, 15 tests.
- `python3 scripts/check_project_success.py` — PASS, 39 contracts and navigation/index.
- `git diff --check` — PASS.
- Active SUCCESS frontmatter inspected — exactly three proposed tags, for `platform/dim-gate`, `systems/clarkq` and `labs/pg-jev-router`; no active mkfk tag.
- Changed paths and workflow diff inspected — documentation/evidence plus the narrow artifact-retention correction; no product runtime change.

ACCEPT covers the truthful readiness downgrade and evidence-retention change. Final-head required CI and review, normal merge, source equivalence and exact remote tag verification remain delivery gates. No tag is justified for mkfk until its unresolved failure is diagnosed and the required requalification evidence is accepted. This addendum does not claim that CI has passed for the newly edited head or that any proposed tag has been published.
