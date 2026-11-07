STATUS: PARTIAL

## Summary

Read-only qualification, 2026-11-01. **A plausible stock-binary route exists: official app-server with explicit `environments: []` on every fresh thread and turn, plus the existing trusted run-bound bridge. It is not yet qualified for live coding.** Pinned source proves shell, apply_patch and view_image resolve an execution environment before accessing files/processes and reject an empty selection. This is materially stronger than sandbox flags or a prompt. Complete installed-binary tool inventory and extension denial still need an offline adversarial probe; no claim of full isolation is made here.

The literal “advertise only three MCP tools” requirement has no verified stock CLI switch. `shell_tool=false` only suppresses shell registration. `apply_patch_freeform` is removed. Do not reject the environment-less candidate merely because a denied `apply_patch` remains advertised: actual authority is the product boundary, per the orchestrator's clarification.

### Pinned evidence

- Installed `codex --version`: `codex-cli 0.166.0`; executable SHA256 `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`.
- Public annotated tag `rust-v0.166.0` resolves through tag object `593389380740f7b4762771573c447ccfdc59742f` to commit `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`. Initial `core/src/tools/spec.rs` HTTP404 was a moved source path, not missing release source.
- Generated experimental schema: `/tmp/fanz-m2-route-schema`. `ThreadStartParams.json` SHA256 `80a40a7fac15b4bf70efb7f893fb353acc0a0d30c68f54aee4f01923deca85de`; `ClientRequest.json` SHA256 `0fedfae5919181b6cdf532b0d155813522418c2c1a93214df6760bf6bd77123a`. Scratch is disposable; source commit links below are durable.

### Exact enforcement and remaining gaps

| Surface | Confirmed pinned behavior | Implication |
|---|---|---|
| Environment selection | `ThreadStartParams.environments=[]` disables environment access; `TurnStartParams.environments=[]` does likewise. `thread/start.environments` is explicitly experimental. | Use explicit empty lists on every start and turn. Never rely on omitted defaults. |
| Shell | `spec_plan.rs:1243–1273` checks `Feature::ShellTool`. `unified_exec/exec_command.rs:165` calls `selected_executor` before parsing/executing commands. | Disable shell feature; even an injected shell call needs an environment. |
| apply_patch | `spec_plan.rs:1426–1428` registers it from model metadata independently of shell feature. `apply_patch.rs:350–359` resolves the environment; file access uses that environment's filesystem. | Empty environments reject execution, despite possible advertisement. |
| view_image | `view_image.rs:143` calls `selected_executor` before joining/reading its requested path. Registration is gated by `Feature::ViewImage`. | Disable `features.view_image`; empty environments also prevent local image reads. |
| Missing environment | `handlers/mod.rs:200–227` searches selected environments and returns a model-facing “No usable execution environment” error; no host fallback appears in this resolver. | Source-supported denial for those three handlers. Runtime denial remains untested. |
| MCP resources | `spec_plan.rs:1277–1290` adds list/read-resource helpers when MCP servers exist. | Three tool names alone are not the full advertised inventory. Existing bridge exposes no resources, but inventory must verify no inherited server exists. |
| Code Mode | `tools/mod.rs:66–86` lets model metadata override feature-selected tool mode. V8 `runtime/globals.rs` exposes tool callbacks and value/media helpers, not Node filesystem APIs; `module_loader.rs` rejects unsupported imports. | `features.code_mode=false` alone is not proof it is absent. Verify nested tools and deny `node:fs`, `file:` imports, `process`, `require`, and network globals in the installed binary. Media callback/extension behavior was not fully audited. |
| Browser/computer/image generation/plugins/hooks | Installed flags and pinned config schema recognize disabling flags. This pass did not find public browser/computer execution implementations in the pinned source tree. Shell source explicitly says hook scripts execute on host. | Empty environments are not a blanket proof for host extensions or hooks. Disable them and prove actual omission/denial, including inherited config and startup behavior. |
| Resume | Upstream `thread_environments.rs:96–124` restores default environments after unloading and resuming without explicit selection. | Never resume uncertain runs. Fresh-thread-only M2 policy avoids this specific pitfall. |

Primary source links: [tool registration](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/spec_plan.rs), [environment resolver](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/handlers/mod.rs#L200), [patch handler](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/handlers/apply_patch.rs#L350), [image handler](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/handlers/view_image.rs#L143), [shell handler](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L165), [resume regression](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/tests/suite/v2/thread_environments.rs#L96), [model override](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/mod.rs#L66), [V8 globals](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/code-mode-runtime/src/runtime/globals.rs), [module loader](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/code-mode-runtime/src/runtime/module_loader.rs).

### Finite next step: offline qualification, then a decision

Use the unmodified pinned app-server binary in a private, clean, trusted host directory and dedicated `CODEX_HOME`; retain subscription authentication only on the trusted host. No repository checkout, AGENTS, plugin hooks, or repo-supplied configuration belongs there. Parent reports app-server lacks `--ignore-user-config`, so do not invent that option. A dedicated home does not automatically eliminate system/managed config: inspect effective `config/read` layers and requirements and reject unexpected servers, plugins, hooks or overrides. Avoid secrets in reports or protocol captures.

Candidate explicit config, all recognized in pinned feature/schema inspection; this is a probe input, **not a demonstrated complete enforcement policy**:

```toml
web_search = "disabled"
[features]
shell_tool = false
view_image = false
browser_use = false
browser_use_external = false
computer_use = false
image_generation = false
apps = false
plugins = false
remote_plugin = false
recommended_plugins = false
tool_suggest = false
hooks = false
multi_agent = false
multi_agent_v2 = false
memories = false
goals = false
shell_snapshot = false
code_mode = false
code_mode_only = false
skill_mcp_dependency_install = false
```

Initialize with experimental API capability; start an ephemeral fresh thread with `environments: []`; send every turn with `environments: []`. Reject any nonempty returned thread environment list. Set approvals to `never` as a noninteractive behavior choice, not the isolation boundary.

Two transport choices preserve existing AP authority: (1) one explicitly configured `fanz_workspace` MCP with `enabled_tools=["read","write","exec"]`, or (2) official `dynamicTools` and `item/tool/call`, forwarding only those three exact schemas to existing `Bridge.call`. The second avoids MCP resource helpers and accidental server discovery, but is an experimental interface. Neither creates a replacement agent loop or moves credentials into the guest. Preserve operation UUID/fingerprint, run/generation, deadline, no-resume and uncertain-operation closure in the existing bridge.

**Inventory proof route:** generated `ClientRequest.json` contains `mcpServerStatus/list` but no full tool inventory RPC. `ThreadStartResponse` and `ThreadReadResponse` expose no complete tool list. `codex debug prompt-input --help` promises prompt input, not tools. Thus a `thread/start`/MCP list check cannot prove all advertised direct, deferred and nested tools. Before a live call, run a strictly local scripted Responses fixture using the stock binary, empty auth/env, no external networking, and a pinned model-catalog fixture. Capture the first outgoing request's tool schemas and use scripted tool-call responses to force forbidden handlers and Code Mode nested calls. Such fixture calls are not live provider inference, but were not executed in this read-only assignment. The pinned source already uses mock Responses fixtures in app-server tests.

Probe must establish: host file/image canaries unreadable; host patch/exec markers unchanged; browser/computer/plugin/hook paths absent or refused; Code Mode cannot import host IO or invoke hidden forbidden tools; only run-bound bridge operations reach AP; no local environment is attached when missing/pending/failed; unknown tools and repeated uncertain operations fail closed. Start with no real credentials; only after all these pass repeat the inventory on the exact permitted model/account route without executing repository code, then run the product canary gate. A mock model catalog alone cannot prove the live account's model metadata or extension inventory.

There is a genuine stronger allowlist in source: `ToolPolicy.allowed_tools` is a startup ceiling applied before tool registration, including generated Code Mode tools, with an upstream regression. It is supplied through Rust `ExtensionDataInit`, not an exposed `thread/start` or config-schema option. Do not invent `allowed_tools` configuration or patch/rebuild the official CLI to reach it. [Policy](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/ext/extension-api/src/tool_policy.rs), [test](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/spec_plan_tests.rs#L501).

Remote exec-server is real and exposed (`environment/add.execServerUrl`, authenticated connection, then selecting its environment), but is not needed for this next probe. It speaks process/filesystem RPC, not the existing MCP/AP workspace contract; integrating it requires a new lifecycle/authority adapter, guest executable provisioning and recovery compatibility work. It is experimental and not a qualified drop-in replacement. [Pinned exec-server README](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/exec-server/README.md).

Official documentation corroborates feature controls and per-MCP allowlists but does not establish an all-tools stock CLI allowlist: [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The [app-server documentation](https://learn.chatgpt.com/docs/app-server) documents version-specific schema generation, experimental dynamic tools and protocol transport limitations. Current documentation and pinned source differ (e.g. current docs mention `tools.view_image`, whereas pinned `ToolsToml` omits it); use verified `features.view_image` for this version.

## Verification

- `codex --version`; `readlink -f /home/ckc/.local/bin/codex`; `sha256sum` of resolved executable — passed
- `codex --help`; `codex features list`; `codex app-server --help`; `codex exec-server --help`; `codex debug prompt-input --help` — passed
- `codex app-server generate-json-schema --experimental --out /tmp/fanz-m2-route-schema`; Python inspection of ClientRequest, ThreadStartParams, TurnStartParams, ThreadStartResponse and MCP status schemas — passed
- Read-only GitHub tag resolution and exact-commit source inspection, official docs fetch/open — passed
- Python `tomllib` parsed the candidate snippet; every listed feature key exists in the exact tagged config schema and `web_search` matches its enum; report status/headings checked; `git diff --check -- .team/fanz-m2-t0442/route-report.md` exited 0 — passed
- Initial sandboxed raw-source fetch failed DNS; approved read-only network fetch succeeded, but obsolete `tools/spec.rs` path returned 404; corrected to pinned `tools/spec_plan.rs` — passed
- Installed-binary adversarial execution and full advertised-tool inventory (requires local fixture execution beyond assigned version/help/config/source-only verification) — skipped
- Live model/provider calls, guest changes, credentials/config mutation, dependency installation, builds, Git mutation (explicitly excluded; none performed) — skipped

## Documentation

Only this report added in the worktree; disposable generated schema/source files are under the orchestrator-authorized `/tmp/fanz-m2-route-schema`. No production files changed. The route remains a qualification candidate, not an accepted route receipt.

## Risks and Follow-ups

Proceed with one bounded offline fixture qualification of the empty-environment/dynamic-tools candidate. Stop before live coding if any installed extension or nested tool retains host access or if actual tool inventory cannot be established. No further remote-backend survey is necessary now. Browser/computer extension enforcement, media callbacks, inherited config, exact live model metadata and no-provider runtime denial remain unresolved. The source denies the inspected filesystem/process handlers; this is not yet an end-to-end proof of every extension.

Research used one bounded source/schema pass and focused environment-denial follow-up. No subagents or provider/model requests were made by this worker; tool-call totals and execution/wait aggregates are not independently reconstructed here (unknown), and must not be substituted with research tool count or worker budget.
