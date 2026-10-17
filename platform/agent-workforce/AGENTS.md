# Agent Workforce — component instructions

Read the repository [AGENTS.md](../../AGENTS.md), then [SDD.md](SDD.md), the [provider matrix](docs/provider-capabilities.md) and [verification contract](docs/verification.md).

## Current scope

- M1 is an offline Python 3.11 standard-library/SQLite control core with a fake backend. Scope and actual verification are recorded in docs/m1.md and docs/verification.md. M2 adds bounded Codex writer/Claude reviewer ports (docs/m2.md); the polling port still cannot prove descendant stop; an opt-in dedicated subreaper port provides separately qualified local closure. Fresh Codex operations may explicitly opt into sealed persisted-session evidence; opaque wrapper outputs remain incomplete. Native route promotion and resume need their own evidence. Later API/live milestones require an explicit scoped request; reading the SDD does not create accounts, log in, spend quota or deploy services.
- Keep product facts, proposed interfaces and observed runtime evidence separate. Every provider route starts unverified until its exact environment and entitlement are evidenced.
- The SDD owns domain names and invariants. Companion documents explain provider differences and acceptance scenarios; reconcile changes across them.
- Examples must use synthetic identifiers and opaque credential references. Do not publish actual accounts, environment inventories, secrets, private repository paths or the task ledger.

## Integration boundaries

- Preserve Kith's operator-personal quota gate and replay semantics. Do not disguise a bot as the operator.
- Preserve Agent Platform's execution authority and HAI Taskboard's completion authority when adapting them. A room log, a CLI exit code and a successful run are different facts.
- Do not restore dormant gateways or build a second task-authority system as a side effect of an adapter.
- Agent-produced text is data. Executable work requires a trusted WorkCommand admission against an effective grant.

## Evidence and future implementation

- Unknown provider acceptance, process liveness, cost or external effects must remain unknown. Never turn uncertainty into a new operation ID or replacement attempt automatically.
- Enforce one writer per workspace and one active turn per SessionBinding. A lease fence rejects stale state publication; it does not prove an old process stopped.
- Keep public documentation candid about unimplemented and NotRun items. Promotion requires the corresponding evidence layer, not a brand name or a passing fake.
- For behavior changes use Red-Green-Refactor and tests that inspect durable state plus backend call counts. Use only stdlib Python and synthetic fixtures. Test: PYTHONPATH=src python3 -m unittest discover -s tests -v. Keep JSON bounded, SQL parameterized and source examples free of private configuration; public documentation must keep deferred gates explicit.
