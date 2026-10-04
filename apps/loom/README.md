# Loom

> **Portfolio doc tier: C (dormant)** — Maintenance repairs do not reopen the plugin/runtime backlog. See [PORTFOLIO.md](../../PORTFOLIO.md) and [documentation policy](../../docs/portfolio-doc-tiers.md).

Loom is a Tauri/Rust + React desktop workspace with canvas nodes, real terminal sessions, Markdown editing, runnable blocks, local output Pin, and AI provider adapters. It is an integrated prototype; reliability and desktop acceptance are still incomplete.

## Current maturity

| Area | Implemented | Remaining limitation |
|---|---|---|
| Contracts | Rust types, generated TypeScript, fixtures/origin tests | Live AI IPC uses separate Rust/TS DTOs rather than the frozen generated AI shape |
| Terminals | Real PTY, output batching/ring, detach/reattach, restart tombstones | Incremental Unicode decoding and shared node cleanup have regression tests; full desktop restart/Run/Pin acceptance remains separate |
| Documents | CodeMirror, disk reads/writes, hash conflicts, runnable Run and local output Pin | Versioned/serialized saves, canonical event identity and create-only missing-file recovery tested; normal saves do not provide cross-process CAS |
| Canvas | Nodes, three edge kinds, sidecar persistence, named `run_in` routing | Invalid/unsupported sidecars block autosave with recovery feedback; no LOD or formal stress acceptance |
| AI | Anthropic/OpenAI/DeepSeek adapters, configurable OpenCode Go, three streaming protocols, connected context sources | One Go `glm-5.3-flash` Chat Completions request verified live; other live model/protocol combinations and native GUI remain unverified |
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

For **OpenCode Go**, use `LOOM_AI_PROVIDER=opencode`, `OPENCODE_API_KEY`, and explicit `LOOM_AI_MODEL` / `LOOM_AI_PROTOCOL` settings. The default gateway is Go's `/zen/go/v1`; protocol choices are `chat-completions`, `responses`, and `messages`. The [OpenCode integration guide](docs/opencode-provider.md) includes private-file launch instructions, model/protocol selection and an opt-in live probe. Invalid settings appear in the AI panel and block sending. See [verification results and remaining live acceptance](docs/opencode-verification.md).

Creating or recreating a missing document never replaces an existing destination. A collision keeps your unsaved edits and offers retry or explicit reload; edits typed while creation is pending remain dirty. See the [creation safety specification](docs/document-create-safety.md) and [verification](docs/document-create-safety-verification.md).

Document Close and canvas Delete/Backspace now ask before discarding unsaved edits. Choose Save and close, Discard changes, or Cancel; failed saves, conflicts and newer edits keep the document open. Pending confirmations preserve canvas connections. See the [close protection specification](docs/document-close-safety.md) and [verification](docs/document-close-safety-verification.md). This protection covers document nodes, not quitting the application or crash recovery.

Closing a document requests cancellation of its active AI work, including a request ID returned after close. Explicit Cancel failures remain visible and retryable. The [AI request lifecycle specification](docs/ai-request-lifecycle.md) and [verification results](docs/ai-request-lifecycle-verification.md) describe cancellation ordering, dropped-request cleanup and remaining acceptance limits.

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
