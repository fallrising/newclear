# Task C2 Plan — Document surface (CodeMirror 6 + runnable block)

| 項目 | 內容 |
|---|---|
| 任務 ID | C2 |
| 軌道 | 前端（Wave 1，但延伸到接 B2） |
| 風險等級 | medium（非 P0，但碰到 B2 的 P0 行為） |
| 模式 | Manual（每階段人類確認） |
| 階段 | ① PLAN（本文）— 待 ② REVIEW |
| 依賴 | A0 凍結點、B2 `DocumentService`、V 殼（Tauri shell） |

> 本文為 docs-first 階段產出，**不含任何實作代碼**。審查通過後才進 ③ IMPLEMENT。

---

## 0. 偏離原 plan 的點（先說清楚）

原 02-task-prompts.md 寫 C2 「對著 A0 的 fake fs / fake document fixtures 開發」。**我打算直接接 B2 真的 `DocumentService`，跳過 mock。**

理由：
1. B2 已驗收完畢、所有 acceptance 自動測過了
2. 我們已經有 V 殼可以開視窗
3. 真接線會比 mock 早暴露 IPC / serialize / 路徑相容性問題（B2-3 conflict 流程跨前後端）
4. 不影響「C2 擁有路徑」的紀律——C2 寫 `src/surfaces/document/**` 與一條 Tauri command bridge；B2 程式碼 0 改動

這是 V 殼那次決定的延續，不是新偏離。

如果你要嚴守 plan、走 mock 路徑，我會調整本 plan。

---

## 1. 目標（一句話）

把 CodeMirror 6 編輯器接到 B2 `DocumentService`，能開 .md、編輯、存檔，看得到 `^block-id` chip、`[[#^id]]` 引用 chip、runnable block 的 ▶ 按鈕；外部改檔有未存變更時走 B2-3 conflict 流程在 UI 上呈現「reload / keep」對話。

---

## 2. 我讀了哪些上游契約 / TDD 段落

| 來源 | 段落 | 用途 |
|---|---|---|
| `contracts/src/command.rs` | `WriteCommand::WriteDocument`, `ReadCommand::ReadDocument` | IPC 形狀 |
| `contracts/src/origin.rs` | `Origin::User` | 寫類命令的 origin 透傳 |
| `contracts/src/edge.rs` | `EdgeKind::Triggers`, `RunInDirective` | 為 C4 預留 ▶ 點擊事件形狀 |
| `contracts/src/ids.rs` | `BlockId` | block-id chip 的 type |
| `loom_core::fs::DocumentService` | 全部 | 後端 API |
| `loom_core::fs::ConflictStatus` | | B2-3 UI |
| `fixtures/documents/with-runnable-block.md` | 全文 | C2 對照 fixture |
| TDD §5.2 | Document Engine | runnable block 雙模式、▶ + output section |
| TDD §6 / D-6 | Edge Router + run_in 物化 | ▶ 點擊後的解析鏈呈現（路由實作在 C4） |
| TDD §7.6 / D-9 | block-id Obsidian 相容 | `^id` + `[[file#^id]]` 格式 |
| TDD §7.2 / D-7 | echo loop + conflict | C2 寫檔對接 echo guard、conflict UI |
| 01-collaboration §8 前端三約束 | 宣告式鎖定 / golden state / 元件收斂 | C2 的 PR 紀律 |
| 03-acceptance C2 全部 | C2-1 ~ C2-5 | 我的綠燈條件 |

---

## 3. 範圍 In / Out

### In

1. **CodeMirror 6 編輯器**
   - 安裝 `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`
   - dark theme 對齊現有 styles
   - 基本快捷鍵（save Cmd+S → 觸發 write）

2. **後端 Tauri command bridge（V 殼擴展）**
   - 新增 `doc_read(path)` → `{ content, on_disk_hash }`
   - 新增 `doc_write(origin, path, content, expected_hash?)` → `WriteOutcome`
   - 新增 `doc_open(path)` / `doc_close(path)` / `doc_mark_dirty(path)` / `doc_mark_clean(path)` / `doc_check_conflict(path)`
   - 新增 `vault_root()` 回傳當前 vault root（v1 從 `LOOM_VAULT` env 或 `~/loom-vault`）
   - 把 `DocumentService` + `FsWatcher` 塞進 `AppState`，在 `run()` 啟動

3. **`fs_changed` event 訂閱**
   - 前端 `ipc.ts` 加 `onLoomEvent` 已經有了；C2 訂閱 `FsChanged` event
   - 當前 open document 對應的 path 被 `Modified` → call `doc_check_conflict` → 視 `ConflictStatus` 決定行為

4. **Runnable block widget**
   - CodeMirror 6 decoration extension：認出 ```\`\`\`lang run` 開頭的 fenced code block
   - widget 在該 block 上方/下方插 ▶ 按鈕
   - 點 ▶ 發出帶 `origin: User` 的 hypothetical command（**v1 只 log + 顯示 toast「will route to terminal X」**，實際 inject 是 C4/E0 的事）
   - 顯示一個 placeholder output section（empty for now，等 feeds-output-to 接線）

5. **Block-id rendering（D-9 / §7.6）**
   - 行尾 `^block-id` → 用 line decoration 顯示成淡色 chip（不改 raw text）
   - `[[file#^block-id]]` → inline replacement decoration，顯示成可點 chip
     - 點擊 v1 只 log「resolve `file#^id`」+ toast；實際跳轉是 C2/E0 future（可能要拆成 `[[file]]` 加 anchor，先 stub）
   - 解析方式：簡單 regex（不做完整 markdown AST），夠 demo 用

6. **Output section placeholder**
   - runnable block 下方一個 collapsible section
   - v1 顯示 `(no output yet — waiting for feeds_output_to)`
   - 結構為未來 ANSI→HTML snapshot 留位置

7. **Conflict prompt UI（接 B2-3）**
   - 外部 `Modified` event + `check_conflict() == Conflict` → 在編輯器頂部出 banner
   - Banner: "External change detected. [Reload] [Keep editing]"
   - Reload → 重新 `doc_read` 蓋掉編輯器
   - Keep → 不動，下次存檔仍能寫（會覆蓋外部變更，但這是使用者明示）

8. **App.tsx 加文件 surface 入口**
   - Header 多一個「open document」按鈕，跳出 path input（v1 簡單）
   - 編輯器與 terminal 並列：左右 split pane（或 tab；§4 決定）
   - 同時最多一個 document open（v1）

9. **宣告式鎖定（§8 約束）**
   - block-id chip 樣式、runnable block widget 結構、output section 結構**用 config 物件定義**
   - 不在 render 時 inline hardcode

10. **Fixtures 對照與 snapshot 測試**
    - 沿用 `fixtures/documents/with-runnable-block.md`
    - 加 unit tests for the parsing logic（regex 認 block-id、認 ```lang run）
    - 視覺 snapshot 測試 v1 **不做**——我們還沒接 Playwright；用人工確認 + golden-state config 替代

### Out（C2 不做）

- 真實命令 inject 到 terminal（C4 → B3 → B1 鏈）
- Edge router 解析鏈（C4）
- `feeds_output_to` 回填邏輯（C4）
- Canvas surface（C3）
- Multi-document tabs（v1 一次一個）
- Vault root 切換 UI（v1 hardcoded path）
- File explorer（v1 用 path input）
- Frontmatter 解析以外的 Markdown AST（v1 用 regex）

---

## 4. 我會改哪些路徑

依 `00-orchestration-master.md` §4，C2 獨佔 `src/surfaces/document/**`。但本 plan 也碰到 V 殼的 IPC bridge（Tauri commands），這部分新增 ipc 邏輯走「append-only on cross-track files」規則。

```
新增（C2 獨佔）：
├── src/surfaces/document/
│   ├── index.ts             # 公開 API
│   ├── DocumentSurface.tsx  # 入口 React component
│   ├── editor.ts            # CodeMirror 6 set-up
│   ├── runnable_block.ts    # decoration extension for ```lang run
│   ├── block_id.ts          # decoration extension for ^id and [[file#^id]]
│   ├── conflict_banner.tsx  # B2-3 conflict UI
│   ├── output_section.tsx   # placeholder for feeds_output_to
│   ├── config.ts            # declarative config (chip styles, block patterns)
│   └── doc_ipc.ts           # typed wrappers for doc_* commands

新增（V 殼擴展，append-only 規則）：
├── src-tauri/src/ipc/
│   ├── doc_commands.rs      # new module: doc_* Tauri commands
│   └── mod.rs               # append `pub mod doc_commands;`

修改（append-only）：
├── src-tauri/src/lib.rs     # 加 DocumentService + FsWatcher 到 AppState；
│                            # invoke_handler! 加 doc_* commands
├── src/App.tsx              # 加 document surface 入口；split pane
├── package.json             # 加 @codemirror/* deps
```

`DocumentService` / `FsWatcher` / B2 模組碼 0 改動。

---

## 5. 對 mock / fixtures 的依賴

| 來源 | 用途 |
|---|---|
| `fixtures/documents/with-runnable-block.md` | parsing / decoration golden state |
| 自製 vault tempdir | dev 跑 `tauri dev` 時的真實寫檔目標 |
| 接 B2 真實 `DocumentService` | 不 mock |

---

## 6. 關鍵設計決策落點

| 決策 | C2 的實現 |
|---|---|
| **D-3**（origin） | 編輯器存檔 / runnable block ▶ 一律帶 `Origin::User` |
| **D-6**（run_in 物化） | C2 只**呈現**解析鏈（▶ 點擊後 toast 顯示「target: <node-id> via run_in」），實際物化在 C4 |
| **D-7**（echo） | doc_write 透過 B2 register echo；fs_changed 走 B2 filter；C2 不另做 |
| **D-9**（Obsidian 相容） | `^id` 與 `[[file#^id]]` 寫入 raw text 完全不動，只用 decoration 顯示 chip。Obsidian 開同檔還是原文。 |
| **§5.2 雙模式** | static block = 純 markdown highlight；runnable block = 多 ▶ + output section。`lang run` 中的 `run` 是觸發器 |
| **§7.2 conflict** | `doc_check_conflict` 在 fs_changed 時觸發；UI banner 走 §3 In 第 7 點 |
| **§8 前端三約束** | 宣告式 config（§3 In 第 9 點）；元件只用既有 CSS（無新自由發揮樣式）；快照測試延後到接 Playwright 才做 |

---

## 7. UI 佈局

```
┌─ Loom ──────────────────────────────────────────────────┐
│ Loom | session=...  [kill][close]  |  doc=notes.md ⓘ    │
├──────────────────────┬──────────────────────────────────┤
│                      │                                  │
│   terminal (xterm)   │   editor (CodeMirror)            │
│                      │                                  │
│                      │   # Title ^heading-1             │
│                      │                                  │
│                      │   plain markdown text            │
│                      │                                  │
│                      │   ```bash run                    │
│                      │   ▶  ls -la                      │
│                      │   ```                            │
│                      │   ┌ output (no output yet) ┐     │
│                      │   └─────────────────────────┘    │
│                      │                                  │
└──────────────────────┴──────────────────────────────────┘
```

Split pane：v1 用 50/50 固定 split（純 CSS flexbox），沒 drag-to-resize。Drag 是後續 polishing。

`spawn shell` 與 `open document` 各自可獨立啟動；同時都關了 → empty state「Click spawn shell or open document」。

---

## 8. 失敗模式與降級

| 情境 | 回應 |
|---|---|
| `doc_read` 路徑不在 vault | UI 顯示 error banner |
| `doc_read` 路徑不存在 | UI 顯示「create new」按鈕，點了就 `doc_write` 空檔 |
| 外部改檔（無未存）| 自動 reload，編輯器顯示 toast |
| 外部改檔（有未存）| Conflict banner（§3 In 第 7 點） |
| `doc_write` 回 `Conflict` | banner「On-disk hash drifted; reload first or force-save」 |
| CodeMirror 拋錯 | error boundary（基於 React 內建）顯示 fallback |
| 同時兩條 fs_changed 對同檔 | check_conflict 是 idempotent，UI 只顯示一個 banner |

---

## 9. 自驗計畫（對應 03-acceptance C2）

| # | 驗收項 | 我怎麼證明 |
|---|---|---|
| C2-1 | runnable block 雙模式 + ▶ + output section | 跑 `tauri dev` 開 `with-runnable-block.md`，截圖確認；加 unit test for regex parser |
| C2-2 | `^block-id` + `[[#^id]]` Obsidian 相容 | 對 fixture 文件 raw bytes 不動的測試；在 Obsidian 開同檔仍可用（人工） |
| C2-3 | output section 容納 `feeds_output_to` snapshot 結構 | 結構 stub 存在；實際填充等 C4，現在只測有沒有預留 |
| C2-4 | ▶ 發 `Origin::User` Command（不自己路由） | unit test：點擊產生的 IPC payload 一定帶 `origin: { kind: "user" }` |
| C2-5 | 三 golden state 快照不跑版 | v1 用人工確認（沒 Playwright）：fixture 文件 render 出來符合預期 |
| C2-bonus | 接 B2 conflict 流程 | integration manual test：開檔 → mark dirty → 外部 `echo "x" >> file` → banner 出現 |

通用：clippy + fmt 全綠（Rust 側）、`npm run typecheck:app` 全綠（TS 側）。

---

## 10. Reviewer 五個問題（我想要的決議）

1. **偏離 plan：直接接 B2 真實 service，不 mock。OK 嗎？**（§0）
2. **UI 佈局：左 terminal、右 document 的 50/50 split。OK 嗎？** 或要 tab？或要可拖 resize？
3. **Vault root：v1 用 `LOOM_VAULT` env 或 `~/loom-vault`（不存在則 mkdir）。OK 嗎？** 還是要彈出 picker？
4. **`[[file#^id]]` chip 點擊行為：v1 只 log + toast（跳轉留未來）。** OK 嗎？
5. **▶ 點擊：v1 只 log + toast「will route to <target>」（不真 inject）。** OK 嗎？我預設「先呈現解析鏈，inject 留 C4」。

**我的 default 答案**：
1. 接真實 B2 ✅
2. 50/50 固定 split ✅（drag 留 polish 階段）
3. `LOOM_VAULT` env，沒設則 `~/loom-vault`，自動 `mkdir` ✅
4. log + toast，不跳轉 ✅
5. log + toast，不 inject ✅

---

## 11. 預估工作量

- C2.1 後端 doc_commands + AppState 整合：~1 session
- C2.2 CodeMirror 6 set-up + markdown highlight + dark theme：~1 session
- C2.3 Runnable block widget（decoration + ▶ + output section）：~1.5 sessions
- C2.4 Block-id rendering（^id + [[file#^id]] chip）：~1 session
- C2.5 Conflict banner + fs_changed 監聽：~1 session
- C2.6 App.tsx split pane + open document button：~0.5 session
- C2.7 Unit tests + manual demo + screenshot：~1 session

合計 ~7 sessions。Manual mode 下每段都會停。

---

## 12. 依賴清單（要加進 package.json）

```json
"@codemirror/state": "^6",
"@codemirror/view": "^6",
"@codemirror/language": "^6",
"@codemirror/commands": "^6",
"@codemirror/lang-markdown": "^6",
"@codemirror/theme-one-dark": "^6"
```

不需要 Rust 端新增 crate（B2 已經夠了）。

---

## 13. 等待 ② REVIEW

請對照：
- §0 偏離 plan 的理由你接受嗎？
- §10 五個問題的 default 答案有沒有要改？
- §4 跨軌共用 IPC 入口的擴展規則（`ipc/mod.rs` append `pub mod doc_commands`、`lib.rs` invoke_handler 加項）你接受嗎？這跟 V 殼那次同個模式
- 預估 ~7 sessions 合理嗎？

**狀態回報**（協作 §7）：

```
[C2] PLAN · WAIT-HUMAN · C2 計畫已交，等 review §0 偏離 + §10 五問 · 下一步：依回饋修計畫或進 ③ IMPLEMENT 第一段（doc_commands + AppState 整合）
```
