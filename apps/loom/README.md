# Loom

AI-native workspace (Tauri + Rust + React/WebView). Canvas is the runtime topology;
edges are the routing table.

## Status

Working build. Canvas, terminals, documents, AI bridge, persistence — all
wired end-to-end. `npm run tauri:dev` opens the desktop shell.

| Track | State | Notes |
|---|---|---|
| A0 contracts + scaffold | ✅ | frozen — see `FREEZE.md` |
| B1 pty_manager | ✅ | ring buffer, re-attach, session_store |
| B2 fs_watcher | ✅ | echo-loop guard, TTL cleanup |
| B4 ai_bridge | ✅ | streaming + `LOOM_AI_PROVIDER` = anthropic \| openai \| deepseek |
| C2 Document surface | ✅ | CodeMirror 6, runnable blocks, output sections |
| C3 Canvas surface | ✅ | react-flow, three edge kinds rendered |
| C4 (min) | ✅ | ▶ injects into active terminal; Pin snapshots output |
| D-4 sidecar | ✅ | `.loom/canvas.json` as main data |
| D-6 run_in | ✅ | frontmatter → synthetic triggers edge |
| B3 mcp + gate | ⏳ | next candidate |
| C4 full (context preview, gate UI) | ⏳ | |
| D1 plugin runtime / D2 inbox | ⏳ | |

## Run it

```sh
# desktop shell (PTY, fs, AI, canvas)
npm run tauri:dev

# AI provider selection (default: anthropic)
export LOOM_AI_PROVIDER=anthropic     # or openai | deepseek
export ANTHROPIC_API_KEY=sk-…          # or OPENAI_API_KEY / DEEPSEEK_API_KEY
export LOOM_AI_MODEL=claude-sonnet-4-6 # optional override
```

## Layout

```
loom/
├── Cargo.toml                    workspace
├── FREEZE.md                     contract-freeze notice (read before changing /contracts)
├── plans/                        task-level plans (per 01-collaboration-protocol §5)
│   └── A0-plan.md
├── contracts/                    Rust IPC contract types (single source of truth)
│   ├── src/
│   │   ├── command.rs            WriteCommand / ReadCommand
│   │   ├── edge.rs               EdgeKind / Edge / RunInDirective (D-6)
│   │   ├── event.rs              Event (incl. PluginEvent D-11)
│   │   ├── ids.rs                typed string newtypes
│   │   ├── node.rs               NodeKind / Node / TombstoneSubject
│   │   ├── origin.rs             Origin (D-3)
│   │   ├── plugin.rs             PluginManifest (D-10), ExtensionPoint
│   │   ├── session.rs            SessionMeta / SessionState
│   │   └── stream.rs             PtyBatch (D-2), AiChunk
│   └── tests/
│       ├── origin_invariant.rs   A0-3: every WriteCommand carries `origin`
│       └── fixtures_load.rs      A0-7: every fixture deserializes into contract types
├── schema/                       concept-level data model docs
│   ├── source-of-truth.md        main vs cache table (D-4)
│   ├── sqlite.md                 SQLite concept schema
│   └── canvas-sidecar.md         .loom/canvas.json format
├── src/
│   ├── contracts/                **generated** TS types (do not edit)
│   └── surfaces/                 reserved for C1/C2/C3 tracks
├── src-tauri/                    reserved for B-track wiring
└── fixtures/                     fake data per downstream track (see fixtures/README.md)
```

## Verify A0

```sh
cargo test -p loom-contracts
```

26 ts-rs export tests + 3 invariant tests + 8 fixture-load tests should pass.
Generated TS lands in `src/contracts/`. If the diff after `cargo test` is
non-empty, the contracts changed without a RFC.

## Next tracks

Read `00-orchestration-master.md` (in the design doc set, not in repo) for
the task DAG. Wave-1 (B1 + B2 + the smallest closed loop proving the two P0
risks — re-attach fidelity and fs echo loop) is complete. Open candidates:

- **C4 full** — `context_for` edge → AI context assembly; gate UI for
  AI-originated writes.
- **B3** — local MCP host + per-node capability tokens + approve-gate
  engine. Required before AI can safely `inject_command`.
- **D1 + D2** — plugin runtime + inbox reference plugin.
