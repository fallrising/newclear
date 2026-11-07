# T-0442 主線重校文件審查

Status: PARTIAL — proposal review; owner decision and runtime qualification pending.

Baseline: newclear `80cf3d88cc4955436106f7df37517e94c3d16f54`. Documents only; no production source, dependency, authentication, deployment or execution boundary changed.

## Independent review route

Owner explicitly requested Claude Code. Installed CLI 2.1.312, exact `claude-opus-5-5`, effort `high`, existing first-party authentication. Each call uses fresh supplied document context, `--safe-mode --restricted --tools "" --strict-mcp-config --permission-mode dontAsk --no-session-persistence --output-format json`; no fallback, tools, writes, subdelegation or MCP. Host timeout 600 seconds per invocation. Tool restrictions are not claimed as OS isolation for future coding tasks.

First review: exit 0, 103.61 seconds; returned model `claude-opus-5-5`, no API error. Conditional support for Fanzloud Web + existing isolated executor + external-agent-first. Identified credential route and overlapping product responsibilities as decisions to settle. Raw receipts are retained privately; no authentication data included here.

## Root disposition

- Accepted: one execution authority; finite three implementation milestones; preserved Cloud live gap; real isolation/canary qualification; bounded fixed-candidate review; explicit subscription/API decision.
- Corrected: reviewer proposed ADR-0003, which already exists; proposal is ADR-0008. No accepted ADR is overwritten.
- Not accepted as established fact: that arbitrary Codex/Claude protocols work with the existing model proxy, that subscription/MCP tool forwarding is safe, or that a particular API credential/allowance has been authorized for this product. All require a concrete qualified route; no paid fallback.
- Not adopted: freeze neighboring projects' entire roadmaps or treat VM residue cleanup as optional. This task changes neither neighboring implementation nor their accepted SDDs; the chosen run must be stopped/cleaned up or explicitly remain unresolved.
- Root keeps M1 as the first complete Web task, then M2 second agent/concurrency, M3 recovery/handoff. This gives an earlier usable result than postponing Web until both agents are integrated.

## Verification and limits

- `python3 scripts/check_project_success.py --projects platform/fanzloud --contracts-only`: PASS.
- `git diff --check`: PASS.
- Second fresh-context Claude review: REVISE, exit 0, 92.40 seconds, exact returned model and no permission denials. Three blockers: explicit O-1 route decision; locate adapter contract within M1; distinguish neighboring accepted responsibilities from new investment authority. All three corrected in the proposal; one bounded focused confirmation completed.
- Codex/root document audit: author/integrator checked TD, accepted ADRs, adjacent SDDs and desk authority; local Markdown targets, project success/navigation and repository index checks PASS. No neighboring implementation changed. Added desk pre-lock executable-reference requirement without claiming it has run.
- Runtime/native tests: NOT_RUN; this change does not modify runtime. Prior fake-browser evidence is retained, not repeated or promoted to live.
- FN-01–07: NOT_RUN. AC-04: live NOT_RUN. AC-05: incomplete.
- Owner route choice and SDD acceptance: pending. Required PR CI and remote readback are separate delivery gates.

## Final independent confirmation and evidence gate

Third/final bounded call: **ACCEPT_PROPOSAL**, no remaining blockers; exit 0, 35.34 seconds, returned `claude-opus-5-5`, no permission denials. B1–B3 resolved. Reviewer accepts readiness for owner decision only, not runtime or implementation. SDD/ADR bytes match the submitted final-review SHA-256 manifest; only this receipt paragraph is appended afterwards.

Codex/root evidence gate: proposal ready for decision; overall **PARTIAL**. Required doc checks and local-reference/scope audit pass. Three Claude invocations observed (103.61s, 92.40s, 35.34s); provider request count, actual billing and whole-session tool/token usage remain unknown. Original review criticisms and dispositions are retained above. No further model review is planned absent a material owner-driven revision.

Missing gates: owner O-1/SDD decision, route-specific executable reference qualification, and all product FN acceptance. Necessary hosted CI/PR state is recorded in the PR; this document does not preclaim it. Existing P0 live AC-04 and persistence AC-05 remain incomplete.
