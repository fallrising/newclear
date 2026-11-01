# Documentation maintenance sweep — 2026-10-23

Source baseline: `f9293219`; documentation-only scope for #392/#395.

| Issue | Outcome and source evidence |
| --- | --- |
| #392 | [Monorepo CI](../../specs/monorepo-ci.md) now lists the actual [Edge Ops workflow](../../../.github/workflows/edge-ops-ci.yml): backend TS gates, root demo-chain check, local workerd/D1 smoke, Go agent contracts, React build and Playwright. Local synthetic/no-credentials/no-deploy boundaries are retained. |
| #395 | [README](../../../platform/agent-platform/README.md), [SDD §2.4/§15.1](../../../platform/agent-platform/SDD.md) and [Agent Computer document](../../../platform/agent-platform/docs/AGENT-COMPUTER.md) explicitly retain requirements/acceptance only. AC-1–AC-4 implementation belongs to another project; a public destination name/location is unspecified and is not invented. Historical Not run evidence is not presented as that other project's current status. Coding M0–M6 table is byte-identical to baseline. |
| #409 | Read-only assessment: [Prism](../../../.github/workflows/prism-ci.yml) still declares15/15-minute job caps; [mkfk](../../../.github/workflows/mkfk-ci.yml) declares30/15/15. [Merged #407](https://github.com/fallrising/newclear/commit/90f74b0e0f9a6c50d40f1d56fbd89b8a0ae99ae9) states the five-minute PR-workflow objective; the current CI specification requires explicit timeouts but does not state a blanket numeric cap. No workflows changed in this documentation task. |

Checks: `python3 scripts/check_indexes.py` passed42 project contracts and five
llms.txt files; scoped relative-link check passed80 links before this report and
confirmed coding M0–M6 table unchanged; final report links/whitespace were checked
separately. No product builds or runtime acceptance were performed. Parent owns
review,commit/PR,CI and merge; #395's original Draft-delivery boundary is retained
for the parent to reconcile with current explicit delivery authority.

## Read-only #409 timing sample

Observed2026-10-23 via GitHub job started_at/completed_at,excluding queue time:

| Completed run | Job durations in seconds | Conclusion |
| --- | --- | --- |
| [Prism39968248096](https://github.com/fallrising/newclear/actions/runs/39968248096) | go168;golangci58 | success |
| [Prism39967760685](https://github.com/fallrising/newclear/actions/runs/39967760685) | go138;golangci63 | success |
| [mkfk39970634373](https://github.com/fallrising/newclear/actions/runs/39970634373) | gates141;chaos56;demo38 | success |
| [mkfk39970285283](https://github.com/fallrising/newclear/actions/runs/39970285283) | gates136;chaos51;demo38 | success |

The issue's historical153-second maximum is not a current upper bound: this
sample reaches168 seconds,still below300. These four completed runs are bounded
hosted-runner observations,not cold-cache guarantees or new runtime tests. A
minimal follow-up can lower only the five timeout values to5 while retaining all
existing tests,artifacts and unconditional teardown. Validate the exact candidate
in CI; do not remove gates,extend the policy silently or interpret one fast run
as a worst-case performance guarantee.
