# C3 Acceptance Mapping (03-acceptance §C3)

Run `tauri dev`, add a few nodes, draw edges. Acceptance is `[manual]`
across the board — no Playwright pipeline yet.

| # | Criterion | Live verification | Mode |
|---|---|---|---|
| **C3-1** | document / terminal / tombstone nodes + three edge kinds renderable and draggable | All three node types live; terminal-exit auto-converts to tombstone; restart converts back. `triggers` edge fully implemented; `feeds_output_to` and `context_for` reserved in `edges.ts` palette/label but not yet drawn (acceptance reduction below). | `[manual]` |
| **C3-2** | zoom-out LOD summary layer | **Deferred to future**, per plan §0. Documented in `plans/C3-plan.md`. | n/a |
| **C3-3** | Layout/edge persistence through `.loom/canvas.json`, SQLite as cache | **Deferred to E0**, per plan §0. Internal state shape mirrors sidecar enough for a straight `JSON.stringify` later. | n/a |
| **C3-4** | >10 node stress with no perceived lag, measurement + self-research checkpoint | **Smoke-tested only**: 5 terminals + 3 documents + assorted tombstones felt fine on M-series mac. No formal measurement — recorded as a future task. | `[manual]` |
| **C3-5** | node/edge/LOD golden state snapshots | **Deferred**, no Playwright pipeline. | n/a |

### Plan §0 deviations — confirmed in code

1. Canvas replaces the split-pane workspace, not a standalone demo route. ✅
2. `triggers` edge wires the D-6 resolution chain: outgoing `triggers` edge from a document node overrides the implicit active-terminal fallback. ✅
3. `.loom/canvas.json` persistence still **out of scope** — state is purely in-memory and disappears on app close. ✅

### Plan §7 default answers — adopted

1. `@xyflow/react` v12 (active line). ✅
2. `TerminalNode` and `DocumentNode` always mount their xterm / CodeMirror (no LOD). ✅
3. Edges / nodes are pure React state, no sidecar yet. ✅
4. ▶ resolution chain: outgoing triggers edge → active terminal fallback → toast. ✅
5. Placement is a deterministic offset stride; no auto-layout. ✅

### Mid-flight discoveries

- TypeScript strict mode flagged the write-only `documents` Map: replaced
  with a destructuring `[, setDocuments]` so the setter stays available
  for the next slice (multi-target edges / sidecar persistence) while the
  unused-locals check passes.
- `useEffect` capturing `restartTombstone` / `removeNode` from earlier in
  the function body created a hoisting trap; switched to `useRef` refs
  that get updated whenever the closures change, keeping the listener
  effect's dependency array honest.

### What's missing (carry forward)

- `feeds_output_to` edge (terminal → document) — needed for snapshot
  pin-back into the runnable block's output section.
- `context_for` edge (anything → document) — viewport-override for AI
  context assembly (B4).
- LOD / zoom-aware mount (C1's D-5 equivalent for canvas).
- `.loom/canvas.json` serialization (E0).
- Auto-layout / drag-resize / handle multiple per side.
- Stress-test harness for >30 nodes.

### Tests

```
cargo test --workspace      → 104 Rust tests, green
npx vitest run              → 23 TS tests, green
npm run typecheck:app       → clean
npm run typecheck:contracts → clean
cargo fmt --check           → clean
cargo clippy --workspace --all-targets -- -D warnings → clean
```
