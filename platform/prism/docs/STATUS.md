# Prism implementation status

Reviewed: 2026-10-23, against newclear `7b1b88dceba67f1d03faf120470e667d4eeb7cd9`.

The [SUCCESS contract](../SUCCESS.md) owns mainline acceptance and usable-version
qualification; the [task board](tasks/BOARD.md) records task completion and evidence.
This page is a dated navigation summary, not a replacement for either source.
Current qualification remains `mainline: incomplete`, `usable_tag: none`.

| Phase / task | Recorded state | Evidence and boundary |
| --- | --- | --- |
| P0–P1 | Historical implementation and local acceptance recorded | [Inventory](inventory.md) and [Phase 1 deployment](../deploy/README.md); the final P1-11 local acceptance supersedes earlier failed checkpoints without removing them. No gates were rerun for this documentation update. |
| P2-01–P2-04 | Closed on task board | [P2-02 through P2-04 evidence](tasks/BOARD.md#p2-02): clean-room LogQL compilation/execution and bounded Loki HTTP query APIs; this is not all Phase 2 acceptance. |
| P2-05 | Merged | [PR #428](https://github.com/fallrising/newclear/pull/428), `dc09beab`: ClickHouse NativeLogQuerier library contract; HTTP still does not route to SearchNative. |
| P2-06 | Completed | [PR #432](https://github.com/fallrising/newclear/pull/432), `475c36ab`: rule loading and SIGHUP reload; AC-87 promtool integration is outside default CI. |
| P2-07 | Merged; T-0354 stopped here | [PR #434](https://github.com/fallrising/newclear/pull/434), `6cdfa421`, and [board closeout](tasks/BOARD.md#p2-07): evaluator/state and standalone API contracts; evaluator is not wired into prismd. |
| P2-08 onward; P3–P5 | Backlog / incomplete | [Remaining task sequence](sdd/12-IMPLEMENTATION-PHASES.md) and [board backlog](tasks/BOARD.md#backlog); no completion or runtime acceptance inferred. |

## Remaining integration boundaries

- [prismd](../cmd/prismd/main.go) mounts the bounded Loki query handler at
  `/loki/api/v1/`; native log-search daemon routing and alert evaluation wiring
  remain pending in SUCCESS AC-04.
- Periodic flush, PostgreSQL integration and AC-87 require separate evidence;
  they are not established by the default CI suite.
- Trace/Jaeger queries, remaining alerting/notification work, alternate drivers,
  agent and control plane remain within the unfinished mainline. Memory retention
  and logical budgeting do not establish production durability or capacity.

The enabled CI entry is the repository-root [prism-ci.yml](../../../.github/workflows/prism-ci.yml):
Go version from the component module, separate golangci-lint, dependency guards
and `make lint test`. The workflow definition is not proof that a particular
candidate passed; consult that candidate's actual Actions result.
