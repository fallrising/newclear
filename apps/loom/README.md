# Loom

> **Portfolio doc tier: C (dormant)** — Maintenance repairs do not reopen the plugin/runtime backlog. See [PORTFOLIO.md](../../PORTFOLIO.md) and [documentation policy](../../docs/portfolio-doc-tiers.md).

Loom is a Tauri/Rust + React desktop workspace with canvas nodes, real terminal sessions, Markdown editing, runnable blocks, local output Pin, and AI provider adapters. It is an integrated prototype; reliability and desktop acceptance are still incomplete.

## Current maturity

| Area | Implemented | Remaining limitation |
|---|---|---|
| Contracts | Rust types, generated TypeScript, fixtures/origin tests | Live AI IPC uses separate Rust/TS DTOs rather than the frozen generated AI shape |
| Terminals | Real PTY, output batching/ring, detach/reattach, restart tombstones | Incremental Unicode decoding and shared node cleanup have regression tests; full desktop restart/Run/Pin acceptance remains separate |
| Documents | CodeMirror, disk reads/writes, hash conflicts, runnable Run and local output Pin | Versioned/serialized saves and canonical event identity tested; cross-process CAS is not provided |
| Canvas | Nodes, three edge kinds, sidecar persistence, named `run_in` routing | Invalid/unsupported sidecars block autosave with recovery feedback; no LOD or formal stress acceptance |
| AI | Anthropic/OpenAI/DeepSeek streaming, connected context sources | UTF-8/framing/EOF/cancellation and send-time context/event ordering tested offline; live providers unverified |
| Session storage | Per-vault SQLite wired to desktop startup and PTY lifecycle; explicit history Restart/Forget and visible storage fallback | Metadata only; no PTY output, unsaved editor buffer, or process reattachment |
| Future capabilities | Design/contract material | MCP host, capability/approval gate, plugin runtime and inbox remain unimplemented |

`feeds_output_to` edges can be drawn/stored, but do not drive the existing local Run/Pin capture. Frozen schema documents describe architecture and supported contract shapes, not proof that every shape is handled by the UI.

The [reliability specification](docs/reliability.md) records the audited gaps and repair acceptance criteria. Historical `plans/*-acceptance.md` files retain their original evidence and are not current all-green declarations.

The [session recovery specification](docs/session-recovery.md) describes the history panel. Restart explicitly reruns the saved command in a new terminal; opening the app never reruns it automatically. Canvas layout remains in `.loom/canvas.json`, and Markdown remains in files. If storage is unavailable or another instance owns the session database, the panel warns that current history is in memory only.

## Run

Prerequisites: Node.js 20+ (a current supported release), Rust **1.88** as pinned in `rust-toolchain.toml`, and Tauri desktop native dependencies. On Debian/Ubuntu these include `pkg-config`, GTK 3 and WebKitGTK 4.1 development libraries (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`), `libayatana-appindicator3-dev`, `librsvg2-dev`, and `patchelf`. A graphical desktop session is needed to open the app.

From the monorepo root:

```sh
cd apps/loom
npm ci
npm run tauri -- dev
```

`npm run dev` alone serves the browser frontend; PTY/filesystem/AI commands require the native Tauri shell. Set `LOOM_VAULT` to choose a vault; the default is `~/loom-vault`.

```sh
export LOOM_AI_PROVIDER=anthropic # or openai | deepseek
export ANTHROPIC_API_KEY=...      # or OPENAI_API_KEY / DEEPSEEK_API_KEY
# Optional provider-appropriate model:
export LOOM_AI_MODEL=...
npm run tauri -- dev
```

Keep API keys in the environment, not vault documents or version control. Real provider calls are separate from offline tests.

## Verify

```sh
cargo test --locked --workspace --no-fail-fast
git diff --exit-code -- src/contracts/
npm run typecheck:contracts
npm run typecheck:app
npm test
npm run build
```

The 2026-10-03 baseline had 37 passing contract tests, 35 passing frontend parser tests, successful typechecks/frontend build, and **72 passing / 1 failing core tests** (Linux self-write rename echo). This is historical baseline evidence, not the result for subsequent repairs. A frontend build is not desktop end-to-end verification.

The [2026-10-04 repair verification](docs/verification-2026-10-04.md) records the earlier reliability slice. The subsequent [session recovery verification](docs/session-recovery-verification.md) records 156 passing Rust tests, 99 frontend tests, ten mocked-IPC browser flows and native Linux boot/recovery/corruption checks, with remaining acceptance gaps. Monorepo automation is defined in [Loom CI](../../.github/workflows/loom-ci.yml); the nested `.github/workflows/ci.yml` is a historical standalone-repository workflow and is not discovered by GitHub in this layout.

## Layout

- `contracts/`, `src/contracts/`: frozen Rust contract source and generated TS; read [FREEZE.md](FREEZE.md) first.
- `src/surfaces/`: implemented canvas and document UI; `src/Terminal.tsx`: terminal UI.
- `src-tauri/src/`: PTY, filesystem, AI, IPC and session-store library.
- `schema/`, `fixtures/`: frozen concept schemas and fixture contracts.
- `plans/`: historical track plans/acceptance; `docs/`: current maintenance specifications.
