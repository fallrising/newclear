ROLE: WORKER
AGENT: native inherited
ID: T-442
Goal: Establish the supported pinned official Codex CLI tool/credential separation route for M2.
Why: Claude's MCP-only trusted driver exists; Codex must never expose host credentials to repository tools.
Inputs to read first: platform/fanzloud/SDD.md sections4–6; platform/agent-platform/docs/EXTERNAL-WORKSPACE.md; src subscription_claude.py/subscription_mcp.py; official OpenAI docs and installed codex0.166.0 help/config schema as needed. Use openai-docs skill.
Scope (may touch): .team/fanz-m2-t0442/route-report.md and disposable /tmp/fanz-m2-route-schema for local no-provider schema generation; read-only inspection elsewhere. Official documentation fetch allowed; do not print secret or private host/account contents.
Out of scope (must not touch): production, git mutations, provider/model invocation, auth/config mutation, VM/runtime, Cloud environment catalog, dependency installs, recursive delegation.
Definition of done:
- [ ] Identify exact supported mechanism to disable ALL host execution/file/image/browser/plugin tools while allowing only run-scoped MCP, OR identify supported remote execution replacement and compatibility gaps.
- [ ] Cite official docs and pinned executable/source evidence. Avoid treating config accepted or prompt instruction as security enforcement. Include proof route to inspect actual advertised tools BEFORE any live coding.
- [ ] State finite recommendation and unsupported/unknowns; no invention. Inspect local source caches if present before downloads; no new clone.
Verify with: version/help/config/source inspection and official docs only; record exact paths/commands/evidence. No live provider call.
Budget:20min active; one research pass, one focused follow-up maximum; output concise report; no subagents.
