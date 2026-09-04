# Task A0 Plan — 契約 + 鷹架 + 資料模型

| 項目 | 內容 |
|---|---|
| 任務 ID | A0 |
| 軌道 | 基礎（唯一前置） |
| 模式 | Manual（每階段人類確認） |
| 角色 | Executor 兼初始 Contract Steward |
| 階段 | ① PLAN（本文）— 待 ② REVIEW |

> 本文為 docs-first 階段產出，**不含任何實作代碼**。審查通過後才進 ③ IMPLEMENT。

---

## 1. 目標（一句話）

建立 Loom monorepo 鷹架，把 **IPC 契約（Command / Event / Stream）**、**資料模型（SQLite schema + `.loom/` sidecar）**、**Rust → TS 型別生成管線**、**fixtures 規範** 一次定死並凍結，讓 B/C/D 三軌之後對著同一份契約與 mock 併行開發。

---

## 2. 我讀了哪些上游契約 / TDD 段落

| 來源 | 段落 | 用途 |
|---|---|---|
| `04-product-context-pack.md` | §1–10 全篇 | 全局理解（canvas = runtime 拓樸、edge = 路由表） |
| `loom-technical-design.md` | §2.1（D-1）、§3.1–3.2（D-2, D-3）、§4（D-4）、§5.2/5.3（D-5, D-6）、§6（三型 edge）、§7.6（D-9） | 進程模型、IPC 形態、資料事實來源、edge 路由 |
| `loom-tdd-12-plugin-inbox.md` | §12.2（D-10）、§12.4（D-11） | plugin 模型、命名空間 event bus 型別形狀 |
| `00-orchestration-master.md` | §3 任務表、§4 所有權地圖、§5 契約變更協定 | 我的擁有路徑邊界、改契約 = RFC |
| `01-collaboration-protocol.md` | §2 迴圈、§4 停止條件、§5 計畫格式、§6 RFC 格式 | 流程紀律 |
| `02-task-prompts.md` | A0 段 | 任務 prompt 原文 |
| `03-acceptance-criteria.md` | A0-1 ~ A0-7 | 我的綠燈條件 |

---

## 3. 範圍 In / Out

### In（A0 要交付）

1. **monorepo 鷹架**
   - Tauri 殼（`tauri.conf.json`、`Cargo.toml` workspace、`package.json`）
   - Rust workspace：`src-tauri/`（含 `crates/contracts`、`crates/loom-core` 主 crate）
   - React/WebView：`src/`（含 surface 子目錄佔位）
   - Rust → TS 型別生成管線（建議用 `specta`；備案 `ts-rs`）
   - CI 骨架（`.github/workflows/`）：`cargo check`、`cargo test`、型別漂移檢查
2. **IPC 契約三形態**（§3.2）
   - **Command**：`open_file` / `spawn_pty` / `resize_pty` / `kill_pty` / `attach_session_view` / `detach_session_view` / `read_document` / `write_document` / `create_node` / `create_edge` / `inject_command` 等型別形狀
   - **Event**：`fs_changed` / `agent_status` / `pty_exited`，預留 `plugin:<id>:<topic>` 命名空間 event 形狀（D-11）
   - **Stream**：`pty_io`（雙向）/ `ai_completion`（單向 + 可取消），帶 stream-id
   - 統一 envelope：所有「會改狀態」的 Command 帶 `origin: User | Ai | Remote | Plugin(String)`（D-3）
3. **資料模型**（§4.2 概念 schema，描述非建表語法）
   - `sessions`（主資料，可降級）：PTY cwd / cmd / shell / 狀態 / last-activity
   - `canvas_nodes`（**快取**，反映 sidecar）：node 種類 / 對應檔案或 session / 座標 / 尺寸 / 所屬 group
   - `canvas_edges`（**快取**，反映 sidecar）：來源 / 目標 / edge 型別
   - `block_index`（快取）：檔案 → block-id → 行範圍
   - `agent_status`（可選快取）
4. **`.loom/` sidecar 格式**
   - `canvas.json`（**主資料**，人類可讀、可進 git）：版本欄位 `version: 1`、`nodes[]`、`edges[]`、佈局欄位
   - `.loom/plugins/<id>/`（為 D1/D2 預留路徑形狀，A0 不放內容）
5. **三型 edge 型別**（§6）
   - `EdgeKind::Triggers | FeedsOutputTo | ContextFor`
   - `RunInDirective`（frontmatter）→ 物化成 `Edge { kind: Triggers, ... }` 的型別簽名預留（D-6）
6. **Fixtures 規範**
   - `/fixtures/pty_stream/*.jsonl`：fake PTY 輸出洪峰、ANSI、resize
   - `/fixtures/fs_events/*.json`：fake fs_changed（含自寫、外部改、rename 風暴四情境）
   - `/fixtures/canvas/*.json`：fake canvas state（含 >10 node 壓力 fixture，供 C3）
   - `/fixtures/documents/*.md` + frontmatter：fake document + runnable block + `^block-id`
   - `/fixtures/edges/*.json`：三型 edge 範例集
   - 每個 fixture 帶一個對應的 loader 範例（為 A0-7 驗收）
7. **契約凍結說明（FREEZE.md）**
   - 寫明「此後改任何 `/contracts`、`/schema`、`.loom/` 形狀都要走 RFC（§5）」
   - 列出 contract steward 流程與 rebase 通知機制

### Out（A0 **不**做）

- 任何真實的 PTY / fs / MCP / AI 行為（B1–B4 軌）
- 任何前端 surface 渲染（C1/C2/C3 軌）
- plugin runtime / event bus 實作（D1 軌）；A0 只定型別形狀
- 真實接線（E0 軌）
- `inject_command` 等工具的 approve gate 邏輯（B3 軌）；A0 只定 Command 型別與 `origin`

---

## 4. 我會改哪些路徑

依 `00-orchestration-master.md` §4 所有權地圖，A0 獨佔：

```
loom/
├── Cargo.toml                       # workspace root
├── package.json                     # frontend root
├── tauri.conf.json
├── tsconfig.json
├── .github/workflows/               # CI 骨架
├── contracts/                       # ★ 契約型別（Rust source）
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                   # 統一 re-export
│       ├── command.rs               # Command + origin envelope
│       ├── event.rs                 # Event + plugin namespace topic
│       ├── stream.rs                # Stream（pty_io, ai_completion）
│       ├── edge.rs                  # 三型 edge + RunInDirective
│       └── plugin.rs                # plugin manifest 型別、event topic
├── schema/                          # ★ SQLite + sidecar schema 文件
│   ├── sqlite.md                    # 概念 schema（描述）
│   ├── canvas-sidecar.md            # .loom/canvas.json 規範
│   └── source-of-truth.md           # 主資料 vs 快取對照表（A0-4 驗收用）
├── src-tauri/                       # Rust workspace 骨架
│   ├── Cargo.toml
│   └── crates/
│       └── loom-core/               # 空殼 crate，引用 contracts
├── src/                             # frontend 骨架
│   ├── contracts/                   # 由 specta/ts-rs 生成的 TS 型別（gitignored 或 checked-in？見 §8）
│   └── surfaces/                    # 空目錄佔位，給 C1/C2/C3
├── fixtures/                        # ★ fake 資料 + loader 範例
│   ├── pty_stream/
│   ├── fs_events/
│   ├── canvas/
│   ├── documents/
│   ├── edges/
│   └── loaders/                     # 每軌一個 loader 範例（A0-7）
└── FREEZE.md                        # 契約凍結說明
```

★ = A0 真正寫東西的地方；其餘為「目錄佔位」。**任何路徑不在上表內就是越界**，會撞 §4-6 停止條件。

---

## 5. 對 mock / fixtures 的依賴

A0 是「定形狀」的軌，自身**不依賴**任何 mock。A0 反而是 fixtures 的**生產者**：

| Fixture | 消費軌 | 用途 |
|---|---|---|
| `pty_stream/*` | B1, C1 | PTY 串流形狀；含洪峰、ANSI、resize |
| `fs_events/*` | B2 | 自寫 / 外部改 / 同時改 / rename 風暴四情境 |
| `canvas/*` | C3, E0 | 含 >10 node 壓力 fixture |
| `documents/*` | C2 | runnable block + `^block-id` + `[[#^id]]` |
| `edges/*` | B4, C4 | 三型 edge 集合 |
| `plugin_manifest/*` | D1, D2 | manifest 載入測試 |

每個 fixture 同目錄附一個 minimal loader 範例（為 A0-7「fixtures 可被任一軌獨立載入」驗收）。

---

## 6. 關鍵設計決策落點（逐條對應 D-x）

| 決策 | A0 的實現方式 |
|---|---|
| **D-1**（介面按 daemon 邊界設計） | Command 命名 / 分組以「對 daemon 發呼叫」心智設計：例如 session 操作獨立於 view 操作；型別不假設「同進程」。MVP 同進程只是 transport 換成函式呼叫。 |
| **D-2**（backpressure + 合批 + 丟舊） | `pty_io` stream 型別預留 batch 結構 `PtyBatch { stream_id, frames: Vec<Frame>, dropped_old: u32 }`；A0 不實作邏輯，只定形狀。 |
| **D-3**（origin 欄位） | 統一 envelope：`Command<T> { origin: Origin, payload: T }`，`Origin` enum 含 `User / Ai / Remote / Plugin(String)`。**型別系統強制**所有寫類 Command 透過此 envelope。 |
| **D-4**（sidecar 主資料、DB 快取） | `schema/source-of-truth.md` 明確標註每張 table 性質；`canvas_nodes` / `canvas_edges` 註解為「cache index of `.loom/canvas.json`」。 |
| **D-5**（PTY/xterm 解耦） | Contract 上把 session lifecycle（`spawn_pty` / `kill_pty`）與 view 訂閱（`attach_session_view` / `detach_session_view`）分成兩組 Command。 |
| **D-6**（`run_in` 物化） | 在 `contracts/edge.rs` 預留 `RunInDirective` 型別與 `materialize_into_triggers_edge` 函式簽名（只簽名、不實作）；下游只認 `Edge`。 |
| **D-9**（Obsidian 相容 block-id） | `block_index` cache key 用 `(file_path: String, block_id: String)`；不另創 schema。 |
| **D-11**（命名空間 event bus） | 在 `contracts/event.rs` 預留 `PluginEvent { plugin_id: String, topic: String, payload: serde_json::Value }`；v1 由 D1 才實作 bus。 |
| **§3.2 單一型別來源** | 選 `specta`（Tauri 1.x/2.x 友好；備案 `ts-rs`）。在 CI 中加 step：跑型別生成 → `git diff --exit-code src/contracts/` → 有 diff 即 CI 紅。 |

---

## 7. 失敗模式與降級

A0 本身不處理 runtime 失敗（那是 B/C/D 的事），但要為下游打地基：

| 情境 | A0 的處理 |
|---|---|
| 契約型別漂移 | 編譯期擋（A0-2）；CI 跑型別生成 + `git diff --exit-code` 雙保險 |
| Fixture 載入失敗 | Loader 範例顯式 `unwrap()` 而非靜默回 `None`，下游軌道才會在第一次跑就發現問題 |
| Sidecar schema 演進 | `canvas.json` 帶 `version: 1` 欄位，未來遷移有錨點 |
| 型別生成工具當機 | CI 有獨立 step；本地有 `scripts/emit-types.sh` 一鍵跑 |

---

## 8. 自驗計畫（對應 03-acceptance）

| # | 驗收項 | 我怎麼證明 |
|---|---|---|
| A0-1 | Rust → TS 型別生成 | 跑 `cargo run --bin emit-types`，產出 `src/contracts/*.ts`；在 TS 端寫一個只 import 的 smoke 檔，`tsc --noEmit` 通過 |
| A0-2 | 故意加欄位編譯期報錯 | 在某 Command struct 多加一個 field（不重生 TS），TS 端 import 處立刻錯；證明後 revert |
| A0-3 | 所有 Command 帶 `origin` | 寫一個 `cargo test` 用 trait/reflection 列舉所有 Command 型別、檢查都實作 `HasOrigin` trait |
| A0-4 | 主資料 vs 快取標明 | 交付 `schema/source-of-truth.md`，請人類審核（manual mode 的天然停點） |
| A0-5 | 三型 edge + `run_in` 物化型別齊備 | 交付 `contracts/edge.rs` 文件 + `materialize_into_triggers_edge` 簽名截圖，人類審核 |
| A0-6 | `plugin:<id>:<topic>` 預留 | 交付 `PluginEvent` 型別 + `contracts/plugin.rs`，人類審核 |
| A0-7 | Fixtures 可被各軌獨立載入 | 每個 fixture 子目錄帶一個 `loader-example.rs` 或 `.ts`，跑 `cargo test --test fixtures` / `vitest run fixtures` 全綠 |

通用驗收（自動）：型別漂移擋、只改了所有權路徑、mock 下能單獨啟動、PR 附計畫與自驗紀錄、失敗模式各演示一次。

---

## 9. 風險與我預期會撞到的停止條件

| 風險 | 何時觸發 | 對應停止條件 |
|---|---|---|
| 規格歧義：`agent_status` 具體欄位 TDD 沒講清 | 寫 `Event::AgentStatus` 形狀時 | §4-5（規格歧義 → 停下問人類） |
| 型別生成工具選擇（specta vs ts-rs） | 鷹架階段 | 技術判斷不在停止條件內，但若你有偏好我會跟；預設選 specta |
| 生成 TS 型別要不要 check-in | 鷹架階段 | 同上；我預設「check-in + CI 擋 diff」雙保險，避免本地沒裝工具就跑不動 |
| `Command<T> { origin, payload }` envelope 太過侵入式 | 寫 contracts 時 | §4-5；若你覺得太重，可改用 marker trait `WritesState`，我會提 alternative |
| 你想加 / 改某個 Command 或 Event | 任何審查點 | A0 階段直接改即可（契約還沒凍結）；A0 交付之後才走 RFC |
| `block_index` 用 `^block-id` 之外的鍵 | 寫 schema 時 | 若 TDD 與 Obsidian 相容衝突 → §4-5 |

**Manual mode 預期停點**：① 你 review 本文（現在）→ ② 我列出具體 Command/Event/Stream 列表請你過目 → ③ 我寫鷹架前再 confirm 一次工具選擇與目錄佈局 → 之後實作階段每跑完一段交回給你看。

---

## 10. 預估工作量

- 鷹架：~1 session（Cargo workspace + Tauri shell + package.json + CI 骨架）
- 契約型別：~2 sessions（Command + Event + Stream + Edge + Plugin namespace）
- Schema + sidecar 文件：~1 session
- Fixtures + loader 範例：~2 sessions（每種 fixture 1 個範例 + loader）
- 型別生成管線 + CI：~1 session
- FREEZE.md + 自驗：~0.5 session

合計 ~7–8 sessions，分多次迴圈交付。manual mode 下每段都會停。

---

## 11. 一句話總結

**A0 只做兩件事：把契約形狀定死、把鷹架立起來。所有「能不能跑」是 B/C/D 軌的事，A0 只決定『大家對著什麼形狀開發』。**

---

## 12. 等待 ② REVIEW

請你（或指派的 reviewer）對照：
- TDD 決策（D-1 ~ D-12）有沒有漏
- 所有權地圖（00 §4）有沒有越界
- 是否誤踩契約凍結後才能做的事
- 工具選擇（specta）是否同意
- 預估工作量是否符合預期

**狀態回報**（協作 §7 格式）：
```
[A0] PLAN · WAIT-HUMAN · A0 計畫已交，等 review · 下一步：依 review 回饋修計畫或進 ③ IMPLEMENT
```
