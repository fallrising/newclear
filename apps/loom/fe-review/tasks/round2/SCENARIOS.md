# Loom R2 scenario evidence map

M1–M3 review-only. All nodes/dialogs are actual React UI driven through synthetic IPC; never replacement DOM. Each matrix context starts fresh unless explicitly re-seeded from a prior synthetic export.

| Scenario | Actual interaction/oracle | Artifact coverage |
| --- | --- | --- |
| empty | vault/canvas/history read; no spawn/restart/stdin | six viewport/preference empty captures |
| populated | keyboard +terminal/+document prompt, notes.md CodeMirror, long content, terminal replay | six viewport/preference populated captures; exact loaded URL/health/axe/overflow |
| editor-close | type/Delete/Backspace preserves node; Cancel preserves dirty editor and incident edge; failed Save/error/conflict preserves both; successful Save/Discard closes only intended doc | desktop focused lifecycle captures + safe command/lifecycle counts |
| edge/run-pin | real handles connect existing edge, zoom; real Run/Pin crosses synthetic stdin/output only | edge identity and exact fake command/output evidence; no feeds_output_to auto-Run claim |
| sidecar reload | await actual canvas_write, export only synthetic snapshot, fresh context re-seed, preserved IDs/edges; terminal becomes tombstone, no automatic restart/stdin | reloaded capture and paired snapshots |
| history states | loading/error/empty/in-memory warning; explicit Restart/Forget | each actual state capture + before/after command counts |
| disposal | close node/context; doc_close, detach/unlisten, no stale callback/pending operation | pre-dispose vs post-dispose counters; forced fixture dispose is distinct from product cleanup |

Keyboard traversals use real Tab/Enter and verify actual active element; observer never fixes focus. Matrix scenes and targeted lifecycle states are complementary, not a claim every scenario ran at every size. Driver must complete every approved M2 scenario before promotion; partial attempts stay partial. All measured a11y/health/visual findings retained for scope assessment, with no product patch authorized here.
