# dim-gate M0 preflight

Observed 2026-09-20. All listed files were fetched at the pinned repository revision and read in full by the orchestrator before product edits or dispatch; no content truncation remains. These hashes are Git blob IDs, not claims that skills were installed.

- newclear: `1117d297aa3efef9472d847c9dfa5714eb6c4460`
- kernel: `7cddad13f965d579b218579609c7f64e1ecf35b2`
- Required readings: 18 newclear + 11 kernel; additional normative references and validator/runner read below.
- Root/platform/ancestor AGENTS.override.md and AGENTS.md absent except project AGENTS.md; verified against recursive tree and local ancestors.
- Existing clean checkout on documentation branch `docs/dim-gate-development-entry`; preserved. PR #5 and #6 confirmed merged. No open PRs, active PLAN owner, tasks, reports or dim-gate implementation branches. Pinned tree contains only project Markdown; no application acceptance evidence.
- Earliest unaccepted milestone M0, AC-01–03. Primary route: current Codex orchestrator, built-in collaboration workers and a separate read-only reviewer. Exact inherited model ID is not exposed by this surface; no model identity invented. Claude, Codex CLI, Cursor Agent, OpenCode, Grok and agy unavailable in PATH. This is multi-agent, not verified multi-model execution.
- All five kernel skill files read as source instructions; no plugin installation or global configuration change. Private reference remains outside public repository.
- Read-through uses actual repository state, not prior conversation memory.
- SDD identity/scope/versioning, atomic command replay, reset generation/epoch, explicit demo mode and scoped CI constrain M0; implementation interface is [M0-CONTRACT](../../platform/dim-gate/docs/M0-CONTRACT.md).

| Repository/path | Git blob | Read |
| --- | --- | --- |
| newclear/.team/PLAN.md | `f64e8ffa0810530631d66ec74cbb3c8d46f1d766` | Full |
| newclear/docs/specs/monorepo-ci.md | `57955c1239ded2c99bab735276d8ae7579249784` | Full |
| newclear/platform/dim-gate/AGENTS.md | `90445d9f653295a6144b39de04b09eced0be4725` | Full |
| newclear/platform/dim-gate/DEVELOPMENT_PROMPT.md | `04a34e6da1c53e3bf9c603055ea2571fc6df6562` | Full |
| newclear/platform/dim-gate/README.md | `649dcf504b7de2bfbed95eab622bf0de1005f2f5` | Full |
| newclear/platform/dim-gate/SDD.md | `ac1f7668cc460a057dbd86dbc8ace75f3db53f71` | Full |
| newclear/platform/dim-gate/docs/DEVELOPMENT_PROTOCOL.md | `aab00fa5df7b8b79102d25aaa6d79d2010c71529` | Full |
| newclear/platform/dim-gate/docs/README.md | `be9949344cf94f7a36c742dae71db47865dbb2c5` | Full |
| newclear/platform/dim-gate/docs/STATUS.md | `b35acbfb612a41c9c7626c49bb4239d31433bae6` | Full |
| newclear/platform/dim-gate/docs/sdd/01-product-ux.md | `cd47f7d2ad4c34e34a12486ef3f839bbc0fdc972` | Full |
| newclear/platform/dim-gate/docs/sdd/02-cmdb-model.md | `c19bf85967ee847897542e3ff4ff964defda5431` | Full |
| newclear/platform/dim-gate/docs/sdd/03-workflows.md | `22a389024f19e264bd6f5b6d863471e66710e170` | Full |
| newclear/platform/dim-gate/docs/sdd/04-permissions-admin.md | `1c0a4eec61a18f326def4406b43c43366c88a94e` | Full |
| newclear/platform/dim-gate/docs/sdd/05-frontend-architecture.md | `826ad9e4e95a577408a489a505083078386e8940` | Full |
| newclear/platform/dim-gate/docs/sdd/06-api-mock.md | `cc7e801ccbd671cf9301f896dbb55ae083f0a2b8` | Full |
| newclear/platform/dim-gate/docs/sdd/07-delivery-validation.md | `2b1265c9183499782567a0b5afb3635ceb036427` | Full |
| newclear/platform/dim-gate/docs/sdd/08-decisions-sources.md | `8150521a4f76ded609b3feaa486d67df8299c817` | Full |
| newclear/platform/dim-gate/docs/sdd/README.md | `453318d28950068417976818f41da8d02d4fbf06` | Full |
| kernel/agents/codex-team-superpowers/AGENTS.md | `a34482bc265eba50260b9e1a0a5f92bc2d20dfda` | Full |
| kernel/agents/codex-team-superpowers/README.md | `9d93647308fdef98c9e034bc5a635173c387d671` | Full |
| kernel/agents/codex-team-superpowers/docs/codex-team-setup.md | `391e8ede24e06e85167a6f3c3282cbe7c2cf5902` | Full |
| kernel/agents/codex-team-superpowers/docs/specs/initial-plugin.md | `f875e72db0c6902ae32c181f1251d43e248c3624` | Full |
| kernel/agents/codex-team-superpowers/docs/specs/ui-delivery.md | `0ad5bc15b28ac614f9ce2adbbd174079e83a8419` | Full |
| kernel/agents/codex-team-superpowers/scripts/teamctl.py | `bb98e0e4cd9f2dd0ec6a738680115ace26aeafe2` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-evidence-gate/SKILL.md | `85d12164e8dd4bfffd556975a53583305e6c2c04` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-task-worker/SKILL.md | `05a2de0f5b98fffd1cab0c930499c07c87dcc759` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-team-delivery/SKILL.md | `26be8ee4caedde9af28b99669289c9747ef94f90` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-ui-design/SKILL.md | `83fa914466bd8a48829064b0c26c0b1cab224ec2` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-ui-design/references/design-heuristics.md | `bfd315704f7e86450f75527491085e44a2b4f3b2` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-ui-evidence/SKILL.md | `bca442849c69fcb9a8e3c6c424abee6db413ed03` | Full |
| kernel/agents/codex-team-superpowers/skills/codex-ui-evidence/scripts/browser-evidence.mjs | `c9f56bf2eddb520b56605e1f9b1e2c2cec54a528` | Full |
| kernel/agents/prompts/dev/README.md | `68e6bc7093b57ed671c99b5d1daaac6062be088b` | Full |
| kernel/agents/prompts/dev/orchestrator-loop.md | `5e85cf55e062880b440d3e11dd3a3f18ef465369` | Full |

Root README and existing AweShore/CloudForm CI were additionally read via `git show` at the pinned newclear commit. Historical standalone installation instructions in kernel README/setup are superseded by the user's explicit kernel-monorepo instruction; no installation was attempted.
