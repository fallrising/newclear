---
document_id: SPEC-ROOT
title: Markdown Annotator 技術規格
project_slug: flowshot
version: 1.0.1
status: approved-for-m0
date: 2026-07-29
authority: product-architecture-security
language: zh-TW
---

# Markdown Annotator — 技術規格與 SDD 執行基線

## 1. 文檔權威與規範語言

本文件是本專案的產品、架構、安全、資料一致性與交付門檻之唯一事實源。它供人類工程師與 LLM agent 直接執行，不包含討論稿、選項比較或未裁決事項。

本文件使用下列規範詞：

- **MUST / 必須**：不符合即不得合併。
- **MUST NOT / 禁止**：命中即為阻斷缺陷。
- **SHOULD / 應**：除非節點文檔留下可驗證理由，否則必須遵守。
- **MAY / 可**：可選實作，不構成交付條件。

每一項事實只能有一個權威來源：

| 事實類型 | 權威來源 |
|---|---|
| 產品範圍、全局不變量、架構與資料模型 | `SPEC.md` |
| 節點需求、BDD、驗收、節點內約束 | `docs/nodes/{ID}-{slug}.md` |
| 可執行任務、檔案 ownership、局部步驟 | `docs/tasks/{ID}/Txx-{slug}.md`，屬衍生文檔 |
| Tauri command DTO 與錯誤型別 | Rust contract source |
| TypeScript contract | 由 Rust contract 生成，禁止手改 |
| 架構決策變更 | `docs/adr/ADR-xxxx-{slug}.md` |
| 驗證證據與一次通過記錄 | `docs/verification/{ID}.md`、`docs/metrics/node-outcomes.jsonl` |

衍生文檔 MUST 帶 `derived_from`、`source_version`、`source_sha256`。來源雜湊不一致時，衍生文檔視為失效，禁止據此繼續開發。

---

## 2. 產品定義

### 2.1 產品目標

本專案交付一個本地優先、唯讀的 Markdown 閱讀與標註桌面應用，並同時驗證文件先行的工程流程。

- **G1：產品目標**
  - 選擇一或多個本地目錄作為 workspace。
  - 以 lazy file tree 瀏覽 Markdown。
  - 同時開啟多份文件並恢復分頁與捲動狀態。
  - 對文字區段建立批注、高亮與留言串。
  - 對文件或批注貼標籤並跨文件檢索。
  - 文件被外部修改、移動或暫時刪除後，批注不得靜默遺失。
- **G2：方法目標**
  - 每個功能節點由 SDD 節點文檔驅動。
  - 每個節點在實作前凍結 contract 與測試計畫。
  - 記錄第一次完整提交是否通過，以及返工屬於規格缺陷、測試缺陷或執行缺陷。

### 2.2 v1 使用者旅程

1. 建立 workspace，加入一個本地根目錄。
2. 展開文件樹並開啟多份 Markdown。
3. 選中文字建立批注，或建立文件級筆記。
4. 在批注下新增留言。
5. 對文件與批注貼標籤，使用標籤篩選結果並跳轉。
6. 使用外部編輯器修改或 `git pull` 更新文件。
7. 應用自動重新渲染並重錨；失敗項進入孤兒列表。
8. 使用者手動重錨或把孤兒轉成文件級筆記。
9. 將批注、留言、標籤與 anchor 匯出到 workspace 外部。

### 2.3 v1 功能範圍

| 類別 | 功能 |
|---|---|
| Workspace | 多根目錄、lazy tree、擴展名過濾、gitignore 風格忽略、大目錄分頁 |
| 閱讀 | GFM、語法高亮、TOC、穩定 heading ID、sanitize、多分頁、捲動恢復 |
| 批注 | 選區捕獲、區段批注、文件級筆記、重疊高亮、顏色、CRUD |
| 留言 | 一層引用、編輯、軟刪除 tombstone |
| 錨定 | TextQuoteSelector、位置提示、來源提示、重錨、孤兒、手動恢復 |
| 標籤 | 文件與批注標籤、rename、merge、autocomplete、AND 過濾、系統標籤 `pin` |
| 輔助 | 檔內搜尋、command palette、watcher、wikilink/backlink、Mermaid、匯出 |
| 本地品質 | SQLite WAL、遷移、結構化日誌、crash report、無遠端遙測 |

### 2.4 明確非目標

v1 禁止加入下列能力：

- AI chat、RAG、embedding、agent tool loop。
- Markdown 編輯、寫回、格式化或自動修復源文件。
- Kanban、Gantt、Dashboard、閱讀統計。
- Inbox、HTTP listener、通知中心。
- PTY、terminal、TUI。
- PlantUML、plugin、多視窗、任意 iframe。
- 雲端同步、帳號、協作伺服器、遠端遙測。

進入 Bonus 評審的必要條件：M4 完成、連續 14 天 dogfood、M3 零資料遺失、核心性能預算全綠。未達條件時，任何非目標功能提案 MUST 被拒絕。

### 2.5 平台與部署基線

- v1 正式驗收平台：macOS 13+，Apple Silicon 與 x86_64。
- Windows/Linux 保持可編譯與架構可攜性，但不構成 v1 release gate。
- 應用名稱：`Markdown Annotator`。
- repository slug：`flowshot`。
- 應用資料目錄 MUST 使用 Tauri 的 platform app-data API，不得硬編碼 `~/.local/share`。
- v1 只支援 UTF-8 Markdown。非 UTF-8 文件顯示明確錯誤，不得以 lossy decode 靜默替換。

---

## 3. 全局不變量

### 3.1 資料與檔案系統

- **INV-1 — Workspace 唯讀**：任何程式路徑禁止寫入、刪除、重新命名或 chmod workspace 內的檔案。匯出目的地必須位於所有 workspace root 之外。
- **INV-2 — 使用者資料不得自動刪除**：批注、留言與文件記錄不做 hard delete。刪除操作使用 `deleted_at` tombstone；背景重錨、watcher、root detach、文件消失都不得刪除資料。
- **INV-3 — 文件消失不等於資料消失**：本地檔案不存在時，`documents.status` 改為 `missing`；原 document UUID、批注、留言與標籤全部保留。
- **INV-4 — 路徑沙箱**：所有檔案系統 command 必須經過單一 `PathGuard`。禁止只用字串 prefix 判斷。
- **INV-5 — 無網路依賴**：核心閱讀、標註、搜尋、Mermaid 與匯出不得依賴網路。v1 Tauri capability 不授予任意 HTTP 權限。
- **INV-6 — 模糊結果保守處理**：重錨與 rename 遷移出現多候選或證據不足時，必須保留原資料並要求人工處理，不得猜測。
- **INV-7 — Contract 單向生成**：Rust contract 是型別與 command 名稱的權威來源；生成的 TypeScript 禁止手改。
- **INV-8 — Core 純函數**：Rust `core` crate 禁止依賴 Tauri、SQLite、檔案系統、時間、網路或環境變數。

### 3.2 安全

- Raw HTML 必須 sanitize。
- Mermaid 使用本地 bundle，`securityLevel=strict`，禁止 HTML label、外部 URL 載入與 script。
- 外部連結只允許 `https:`, `http:`, `mailto:`，且只能由明確使用者操作開啟。
- 日誌禁止記錄文件正文、批注正文、留言正文與完整 anchor exact；路徑預設只記 workspace-relative path。
- 前端不得直接使用通用 filesystem plugin；所有讀取經 Rust command 與 `PathGuard`。
- CSP 預設 `default-src 'self'; script-src 'self'; img-src 'self' blob:`，禁止 `unsafe-eval` 與 remote origin；style 只按實際 renderer 需求最小開放。

---

## 4. 技術架構

### 4.1 技術棧

- Desktop shell：Tauri 2。
- Backend：Rust stable。
- Frontend：React 19、TypeScript、Vite。
- Markdown pipeline：unified / remark / rehype。
- Database：SQLite，`rusqlite`，WAL。
- Contract generation：`ts-rs` + 專案 `xtask contracts`。
- Rust tests：內建 test、`proptest`、benchmark harness。
- Frontend tests：Vitest、React Testing Library。
- E2E：Playwright 驅動打包後應用；只作本機 release gate。
- Logging：Rust `tracing`，前端透過受控 bridge 寫入同一日誌。

### 4.2 Repository 結構

```text
flowshot/
├── SPEC.md
├── Cargo.toml
├── Makefile
├── package.json
├── src/                              # React application
│   ├── features/
│   ├── lib/document-model/           # Markdown → HTML + canonical text + source map
│   ├── generated/contracts/          # generated; no manual edits
│   └── test/
├── src-tauri/                         # Tauri adapter, commands, watcher, PathGuard
├── crates/
│   ├── core/                          # pure domain logic: anchors, reanchor, tag normalization
│   ├── db/                            # migrations and typed repositories
│   └── xtask/                         # contract generation and repository checks
├── contracts/
│   └── locks/                         # per-node frozen contract metadata
├── docs/
│   ├── graph.yaml
│   ├── nodes/
│   ├── tasks/
│   ├── adr/
│   ├── verification/
│   ├── metrics/node-outcomes.jsonl
│   ├── protocols/
│   └── templates/
├── fixtures/                          # synthetic, privacy-safe fixtures only
└── scripts/
```

`crates/core` MAY 依賴 `serde`、`thiserror`、Unicode/相似度演算法套件，但 MUST NOT 依賴 IO adapter。DTO 可定義於 `core::contracts`，Tauri 實作必須直接使用同一 DTO。

### 4.3 模組邊界

| 模組 | 責任 | 禁止 |
|---|---|---|
| `document-model`（TS） | 解析 Markdown、sanitize、產生 deterministic HTML、canonical text、TOC、source map | DB、Tauri command、業務持久化 |
| `core::anchor`（Rust） | Anchor 建立、候選評分、重錨、狀態結果 | 讀檔、SQL、時鐘 |
| `db`（Rust） | migration、transaction、repository、資料不變量 | UI 狀態推導、Markdown 解析 |
| `src-tauri` | command adapter、PathGuard、watcher、事件、日誌 | 重複實作 core 演算法 |
| React features | UI、DOM selection、query/cache、互動狀態 | 直接 SQL、直接 filesystem |

### 4.4 前端狀態

- Tauri/SQLite 持久化資料使用 query cache 管理。
- 暫態 UI 狀態使用 feature-local reducer 或輕量 store。
- `open_tabs`、active workspace、每 tab 捲動位置寫入 `app_state`；禁止以 localStorage 作權威來源。
- 更新或刪除既有 versioned entity 必須帶對應 concurrency token：
  annotation/comment 使用 `row_version`，document snapshot 使用
  `expected_revision`，app state 在 compare-and-set 更新時使用
  `expected_updated_at`。Create、idempotent desired-set 與 tag merge 不要求虛構
  row version，但仍必須在單一 transaction 內完成。衝突回傳 `CONFLICT`，
  UI 重新載入後再提交。
- Range annotation 與 manual reanchor 使用同一 snapshot contract：

```ts
interface DocumentSnapshotRef {
  documentId: string;
  documentRevision: number;
  observedSourceHash: string;
  canonicalHash: string;
  documentModelVersion: number;
}
```

Snapshot mutation 前，Tauri adapter MUST 以 stable read 驗證目前檔案 raw hash 仍等於 `observedSourceHash`，DB MUST 驗證 committed revision/hash/model version 一致。任一不符回 `CONFLICT`，`details.reason="document_snapshot_stale"`，不得部分寫入。UI 收到 `document://changed` 後必須把當前 model 標為 stale，暫停建立 range annotation 與 manual reanchor，直到 refresh/reanchor 完成。

### 4.5 主要資料流

#### 開啟文件

1. UI 呼叫 `open_document(document_id)`。
2. Rust 經 `PathGuard` 讀取 bytes、驗證 UTF-8、計算 **observed** raw SHA-256。
3. `open_document` 可更新 `last_seen_at/mtime/size`，但 MUST NOT 推進 document revision，也不得覆寫已提交的 source/canonical hash。
4. UI 的 `document-model` 解析一次，產生 `DocumentModel`。
5. UI 驗證 `DocumentModel.source_hash` 與 observed source hash 一致。
6. UI 顯示 HTML，載入 annotation，呼叫 `reanchor_document`。
7. DB 以 optimistic revision transaction 提交 observed source hash、canonical hash、document model version 與重錨結果；即使沒有 annotation，也由此 transaction 提交新文件版本。
8. `reanchor_document` 回傳新的 `DocumentSnapshotRef`；只有此後 UI 才啟用 range annotation mutation。
9. UI 依區間切割文字 segment，渲染重疊高亮。

#### 建立批注

1. DOM selection 映射到 canonical UTF-8 byte range。
2. UI 呼叫 `build_anchor`，輸入 canonical text、range、source hash、canonical hash、model version、可選 source span。
3. Core 產生 `AnchorV1`。
4. UI 呼叫 `create_annotation`，range annotation 同時攜帶目前 `DocumentSnapshotRef`。
5. Adapter 重新驗證 stable file hash；DB transaction 驗證 snapshot revision/hash/model version後寫入 annotation。
6. 任一 snapshot mismatch 回 `CONFLICT`；UI refresh 後要求使用者重新確認 selection。
7. UI invalidates document annotation query。

#### 外部修改與重錨

1. watcher 將同一路徑事件 debounce、coalesce。
2. 每個 document 由單一序列 queue 處理。
3. hash 未變則忽略。
4. watcher 發出 `document://changed`，帶 `document_id`、`old_revision`、observed source hash；watcher 不先寫入 committed hash。
5. UI 重新呼叫 `open_document` 取得穩定 source，重建 `DocumentModel`，提交 `reanchor_document(expected_revision=old_revision)`，並附 compact source-map segments 供更新 source span hint。
6. Adapter 在 transaction 前再次驗證目前 file hash 等於 request observed hash，並重算 canonical hash；不一致即回 `CONFLICT`/`RENDER_MODEL_MISMATCH`。
7. transaction 若 revision 已變，回 `CONFLICT`；呼叫端丟棄舊結果並重跑最新版本。
8. transaction 一次寫入 document revision、annotation 狀態與 anchor event。
9. UI 顯示 exact/context/fuzzy/orphaned 統計。

---

## 5. Canonical Document Model

### 5.1 原則

Anchor 的權威對象是**渲染語義的 canonical text**，不是 DOM offset，也不是 Markdown source offset。為保留未來「跳到來源行」能力，render pipeline 同時產生 best-effort source map；source span 只是提示，不參與 anchor 身份判定。

### 5.2 `DocumentModel`

```ts
type ByteOffset = number; // zero-based UTF-8 byte offset; ranges are [start, end)

interface DocumentModel {
  schemaVersion: 1;
  sourceHash: string;             // SHA-256 of raw UTF-8 source bytes
  canonicalText: string;
  canonicalHash: string;          // SHA-256 of canonicalText UTF-8 bytes
  html: string;                   // sanitized
  toc: TocItem[];
  segments: TextSegment[];
}

interface TextSegment {
  id: string;                     // deterministic within the document model
  kind: "prose" | "code";
  canonicalStart: ByteOffset;
  canonicalEnd: ByteOffset;
  sourceStart?: ByteOffset;
  sourceEnd?: ByteOffset;
  sourceStartLine?: number;       // one-based
  sourceEndLine?: number;         // one-based, inclusive hint
}
```

HTML 的每個可選文字 leaf MUST 可追溯到一個 `TextSegment`。所有 byte range 為 zero-based half-open `[start,end)`；source line 為 one-based。segment ID 由 AST 路徑與內容序號確定性產生，禁止 random UUID。

### 5.3 Canonicalization v1

1. 輸入解碼為 UTF-8；換行統一為 `\n`。
2. 所有文字做 Unicode NFC。
3. Prose 內：
   - tab、NBSP 與水平空白 run 折疊為一個 ASCII space。
   - soft break 轉成一個 space。
   - hard break 轉成一個 `\n`。
4. block 邊界輸出一個 `\n`；連續 block separator 最多保留兩個 `\n`。
5. fenced/indented code 內保留空白與縮排，只統一換行與 NFC。
6. YAML/TOML front matter 由 parser 識別，但不進 body HTML 與 canonical text；v1 不自動把 front matter tag 匯入本專案標籤。
7. 隱藏或不渲染內容不進 canonical text。
8. Raw HTML 經 sanitize 後，僅可見文字進 canonical text。
9. 同一 source 在相同 pipeline 版本下，`canonicalText`、`html`、`segments` 必須逐 byte 相同。

Pipeline 版本變更可能使 anchor 全量失效，因此 canonicalization 行為改動 MUST 提升 `DocumentModel.schemaVersion`，並以 ADR + migration/replay plan 處理；不得在普通功能 PR 中修改。

---

## 6. Anchor 與重錨

### 6.1 `AnchorV1`

```json
{
  "version": 1,
  "document_model_version": 1,
  "exact": "selected canonical text",
  "prefix": "up to 32 Unicode scalar values",
  "suffix": "up to 32 Unicode scalar values",
  "start_hint": 1234,
  "end_hint": 1288,
  "offset_unit": "utf8-byte",
  "source_hash": "sha256",
  "canonical_hash": "sha256",
  "source_span_hint": {
    "start_byte": 1300,
    "end_byte": 1360,
    "start_line": 42,
    "end_line": 43
  }
}
```

- `version` 是 anchor JSON schema version；`document_model_version` 必須等於產生它的 `DocumentModel.schemaVersion`。
- `exact` MUST 非空；全空白 selection 不得建立 range annotation。
- prefix/suffix 以 Unicode scalar 計數，序列化為 UTF-8。
- `start_hint/end_hint` 是 zero-based half-open UTF-8 byte range，必須落在 canonical UTF-8 char boundary。
- source span 是可選提示；只有 intersected segments 的 source ranges 全部存在且順序單調時才可寫入，否則為 null。其錯誤不得導致 annotation 遺失。
- v1 只接受 `document_model_version=1`。遇到未知版本回 `UNSUPPORTED_MODEL_VERSION`，不得用新 canonicalizer 直接猜測舊 anchor。

### 6.2 持久狀態

Annotation 使用下列穩定狀態：

- `document`：文件級筆記，`anchor_json IS NULL`。
- `attached`：有可渲染區間；最近一次結果可為 unchanged/exact/context/fuzzy/manual。
- `orphaned`：無可靠區間；原 anchor 凍結。

`shifted` 與 `recovered` 是 **anchor event outcome**，不是長期狀態。這避免「recovered 何時回到 anchored」的雙義。

### 6.3 重錨演算法

`reanchor(anchor, new_canonical_text)` 為純函數，回傳：

```rust
enum ReanchorResult {
    Attached {
        range: ByteRange,
        method: MatchMethod,      // Unchanged | Exact | Context | Fuzzy
        outcome: EventOutcome,    // Unchanged | Shifted
        updated_anchor: AnchorV1,
        score: f32,
    },
    Orphaned {
        reason: OrphanReason,
        frozen_anchor: AnchorV1,
    },
}
```

演算法順序：

1. **Unchanged fast path**：canonical hash 相同且 hint 範圍內容等於 `exact`。
2. **Exact candidate search**：尋找所有 `exact` 出現位置。
   - 只有一個 candidate 時通常直接接受，method=`exact`。
   - 若 `exact` 少於 4 個 Unicode scalar，唯一 candidate 仍須滿足 `max(prefix_score,suffix_score) >= 0.50` 或與 position hint 距離 `<= 256 bytes`；否則 orphan。
3. **Context ranking**（exact 有多個 candidate 時）：
   - `prefix_score = matched_prefix_scalars / max(prefix_scalars, 1)`。
   - `suffix_score = matched_suffix_scalars / max(suffix_scalars, 1)`。
   - `position_score = 1 / (1 + abs(candidate_start-start_hint)/1024)`。
   - `rank = 0.45*prefix_score + 0.45*suffix_score + 0.10*position_score`。
   - 只有在 `max(prefix_score,suffix_score) >= 0.50` 且 top 與 second-best 的 rank 差距 `>= 0.15` 時接受，method=`context`。
   - exact 多候選仍無法消歧時直接 orphan；不得進入 fuzzy 猜測。
4. **Fuzzy candidate generation**：
   - 先在 position hint ±4096 bytes 範圍內搜尋。
   - 再以 exact 的 4-gram fingerprint 產生全文件候選窗。
   - 以 Unicode scalar 為單位計算 normalized edit similarity。
   - `fuzzy_score = 0.75*text_similarity + 0.20*context_score + 0.05*position_score`，其中 `context_score=(prefix_score+suffix_score)/2`。
5. **保守接受規則**：
   - top fuzzy score `>= 0.82`。
   - top 與 second-best fuzzy score 差距 `>= 0.08`。
   - 無唯一候選、exact 過短而無可靠 context、或超時時一律 orphan。
6. 任何 attached 結果都必須以新 document model 更新 `prefix/suffix/start_hint/end_hint/canonical_hash/source_hash`；fuzzy 另更新 `exact`。若提供的 source map 能完整覆蓋新 range，更新 `source_span_hint`，否則將該 hint 設為 null，禁止保留已知過期行號。
7. 舊 anchor 完整寫入 event audit。
8. `exact` 少於 4 個 Unicode scalar 時禁用 fuzzy，只允許通過短字串 guard 的 exact/context。

門檻是 v1 contract。修改門檻必須附真實 git history replay 數據與 ADR。

### 6.4 批量與併發

- `reanchor_document` 一次處理該 document 所有未刪除 range annotation。
- 輸入必須帶 `expected_document_revision`。
- DB transaction 以 `WHERE revision = expected_revision` 更新；零列受影響即回 `CONFLICT`。
- 同一 transaction 寫入：
  - 新 document source/canonical hash。
  - `revision + 1`。
  - 每個 annotation 的 `anchor_status`、`anchor_json`、`last_resolution`。
  - 每個 annotation 的 anchor event。
- 不允許逐 annotation 分散 commit。
- 同一 document 的 watcher job 必須序列化；不同 document 可平行。

---

## 7. 文件身份、Watcher 與 Rename

### 7.1 文件身份

- document 的穩定身份是 UUID，不是 path。
- 目前位置由 `(root_id, rel_path)` 表示。
- source hash 是版本證據，不是唯一身份。
- 文件消失只改 `status=missing`。
- root detach 不刪除 document；只停止掃描並保留 metadata。

### 7.2 Rename 策略

依序使用：

1. watcher 提供的可信 rename pair，且 old/new 均位於同一 workspace。
2. 5 秒事件窗內，恰好一個 `missing` 舊 document 與一個新 path 的 source hash 相同。
3. 可選平台 file-id/inode hint，只作加分證據，不單獨決定。
4. 候選不唯一時不自動遷移；保留舊 document 為 missing，建立新 document，UI 提供人工「這是同一文件」合併操作的未來擴充點。v1 不實作自動猜測。

### 7.3 Watcher 行為

- debounce quiet window：500 ms；最大等待：2 s。
- 事件按 canonical path coalesce。
- atomic-save 形成的 create/rename/remove 風暴必須合併為一個穩定結果。
- hash 未變不觸發 render/reanchor。
- watcher 不跟隨 symlink。
- watcher 只通知變更；canonical document model 仍由唯一 render pipeline 產生。

---

## 8. 路徑沙箱

`PathGuard` 必須執行以下步驟：

1. 從資料庫載入 root 的 canonical path。
2. 對直接 command `rel_path` 拒絕 absolute、NUL、空 component、`..` component。
3. 對 Markdown href：先分離 fragment，URL-decode 一次，以 source document directory 或 leading `/` 的 current-root 基準正規化；可接受合法 `..`，但正規化後若逃逸 root 必須拒絕。禁止 double-decode、encoded separator 與未知 scheme。
4. 以 component join 產生 candidate。
5. 對既有 target 執行 canonicalize。
6. 以 path component containment 驗證 target 位於 canonical root 內；禁止字串 prefix。
7. 若任一路徑 component 是 symlink，v1 拒絕讀取或展開。
8. 讀檔使用 no-follow/open-handle 能力（平台可用時必須啟用），並在 read 前後比較 file identity/size/mtime；讀取期間改變時最多重試 2 次，仍不穩定則回 retryable `IO_ERROR`。
9. TOCTOU 敏感操作在 open 後再次驗證 metadata；所有操作只讀。
10. export destination 對所有 root 做反向 containment 檢查，位於任一 root 內即拒絕。

文件樹可顯示 symlink 項目，但必須標記為不可展開、不可開啟。

---

## 9. 資料模型

### 9.1 SQLite 設定

所有 SQLite 操作必須在 blocking DB executor 執行，不得阻塞 Tauri async runtime。v1 使用單一 write actor 序列化寫入；讀取可使用有界 read connections。測試必須能注入固定 clock 與 ID generator。

每個 connection MUST 設定：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

migration 只提供 `up`，必須可重跑檢查、不可跳版。破壞性 migration 前必須先建立 DB backup；v1 不允許破壞性 migration。

### 9.2 Canonical schema

以下為 v1 邏輯 DDL；實際 migration 可拆檔，但語義不得偏離。

```sql
CREATE TABLE workspaces (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    archived_at   INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE workspace_roots (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
    abs_path          TEXT NOT NULL,
    canonical_path    TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('active','detached')),
    ext_filter_json   TEXT NOT NULL CHECK (json_valid(ext_filter_json)),
    ignore_rules_json TEXT NOT NULL CHECK (json_valid(ignore_rules_json)),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    UNIQUE (workspace_id, canonical_path)
);

CREATE TABLE documents (
    id                  TEXT PRIMARY KEY,
    root_id             TEXT NOT NULL REFERENCES workspace_roots(id),
    rel_path            TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('present','missing')),
    source_hash         TEXT,
    canonical_text_hash TEXT,
    model_version       INTEGER,
    size_bytes          INTEGER,
    mtime_ms            INTEGER,
    revision            INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    last_seen_at        INTEGER,
    last_opened_at      INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    UNIQUE (root_id, rel_path)
);

CREATE INDEX idx_documents_root_status
    ON documents(root_id, status);
CREATE INDEX idx_documents_last_opened
    ON documents(last_opened_at DESC);

CREATE TABLE annotations (
    id                       TEXT PRIMARY KEY,
    document_id              TEXT NOT NULL REFERENCES documents(id),
    kind                     TEXT NOT NULL CHECK (kind IN ('range','document')),
    body                     TEXT NOT NULL DEFAULT '',
    color                    TEXT NOT NULL DEFAULT 'yellow'
                             CHECK (color IN ('yellow','green','blue','pink','purple')),
    anchor_status            TEXT NOT NULL
                             CHECK (anchor_status IN ('attached','orphaned','document')),
    anchor_json              TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
    last_resolution          TEXT NOT NULL DEFAULT 'none'
                             CHECK (last_resolution IN
                               ('none','unchanged','exact','context','fuzzy','manual')),
    last_reanchored_revision INTEGER,
    row_version              INTEGER NOT NULL DEFAULT 0,
    deleted_at               INTEGER,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    CHECK (
      (kind = 'document' AND anchor_status = 'document' AND anchor_json IS NULL)
      OR
      (kind = 'range' AND anchor_status IN ('attached','orphaned') AND anchor_json IS NOT NULL)
    ),
    CHECK (kind = 'range' OR length(trim(body)) > 0)
);

CREATE INDEX idx_annotations_document_active
    ON annotations(document_id, deleted_at, anchor_status);

CREATE TABLE annotation_anchor_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    annotation_id     TEXT NOT NULL REFERENCES annotations(id),
    document_revision INTEGER NOT NULL,
    trigger_source    TEXT NOT NULL
                      CHECK (trigger_source IN ('open','watcher','manual','replay')),
    outcome           TEXT NOT NULL
                      CHECK (outcome IN ('unchanged','shifted','orphaned','recovered')),
    method            TEXT NOT NULL
                      CHECK (method IN ('none','exact','context','fuzzy','manual')),
    score             REAL,
    old_anchor_json   TEXT CHECK (old_anchor_json IS NULL OR json_valid(old_anchor_json)),
    new_anchor_json   TEXT CHECK (new_anchor_json IS NULL OR json_valid(new_anchor_json)),
    reason_code       TEXT,
    created_at        INTEGER NOT NULL
);

CREATE INDEX idx_anchor_events_annotation
    ON annotation_anchor_events(annotation_id, id DESC);

CREATE TABLE comments (
    id            TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL REFERENCES annotations(id),
    parent_id     TEXT REFERENCES comments(id),
    body          TEXT NOT NULL CHECK (length(trim(body)) > 0),
    row_version   INTEGER NOT NULL DEFAULT 0,
    deleted_at    INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_comments_annotation
    ON comments(annotation_id, created_at);

CREATE TABLE tags (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL DEFAULT 'user'
                    CHECK (kind IN ('user','system')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    CHECK (length(trim(display_name)) BETWEEN 1 AND 64)
);

CREATE TABLE document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id),
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE annotation_tags (
    annotation_id TEXT NOT NULL REFERENCES annotations(id),
    tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (annotation_id, tag_id)
);

CREATE INDEX idx_document_tags_tag ON document_tags(tag_id, document_id);
CREATE INDEX idx_annotation_tags_tag ON annotation_tags(tag_id, annotation_id);

CREATE TABLE app_state (
    scope       TEXT NOT NULL,
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
);

CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  INTEGER NOT NULL
);
```

### 9.3 必要 trigger

- 禁止對 `documents`、`annotations`、`comments` 執行 hard delete。
- comment parent 必須：
  - 存在。
  - 屬於同一 annotation。
  - parent 本身的 `parent_id IS NULL`，以保證最多一層。
- system tag 禁止 rename/delete。
- system tag `pin` 只能綁定 document。
- `workspace_roots.workspace_id` 與 document 查詢的 workspace 必須由 join 決定，不存重複 workspace_id。
- 所有 trigger 必須有 migration test。

### 9.4 軟刪除語義

- `delete_annotation` 將 annotation 與其 comments 的 `deleted_at` 設為同一 timestamp。
- `delete_comment` 只設該 comment 的 `deleted_at`；回覆仍保留並顯示「原留言已刪除」。
- v1 不提供永久 purge。
- 匯出預設不包含已刪除資料；JSON backup 模式可選包含 tombstone。

### 9.5 Tag normalization

`normalized_name` 的生成規則：

1. trim。
2. Unicode NFKC。
3. Unicode default case folding。
4. 再次 trim。
5. 空字串拒絕。

`/` 在 v1 只是普通字元，不建立層級語義。`cloud/aws` 可作顯示名稱，但查詢、merge 與 autocomplete 都視為單一平面標籤。

---

## 10. Contract 與 Command API

### 10.1 Contract 規則

- Rust request/response/error type 是權威來源。
- 每個 command 形式為 `Result<Response, AppErrorDto>`。
- command request 必須使用單一 object，不使用多個 positional argument。
- `xtask contracts` 生成：
  - TypeScript DTO。
  - typed `invoke` wrapper。
  - command manifest。
- `make check-contracts` 重新生成到暫存目錄並比較 git；有差異即失敗。
- 每個節點凍結 `contracts/locks/{ID}.json`，包含 source hash、凍結時間、command 列表。
- Contract 變更遵循：
  - 未完成節點：更新 node spec、test plan、lock。
  - 已完成節點：新增 ADR 或向後相容版本；禁止靜默 breaking change。

### 10.2 通用錯誤

```ts
interface AppErrorDto {
  code:
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "CONFLICT"
    | "PATH_OUTSIDE_WORKSPACE"
    | "SYMLINK_FORBIDDEN"
    | "UNSUPPORTED_ENCODING"
    | "DOCUMENT_TOO_LARGE"
    | "ASSET_TOO_LARGE"
    | "UNSUPPORTED_MEDIA_TYPE"
    | "EXPORT_PATH_FORBIDDEN"
    | "RENDER_MODEL_MISMATCH"
    | "UNSUPPORTED_MODEL_VERSION"
    | "IO_ERROR"
    | "DB_ERROR"
    | "MIGRATION_ERROR"
    | "INTERNAL";
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
}
```

`message` 對使用者可讀；內部 stack、SQL 與正文不得放入 DTO。

### 10.3 v1 Command surface

| 節點 | Command |
|---|---|
| N00 | `get_build_info` |
| N02 | `list_workspaces`, `create_workspace`, `add_workspace_root`, `detach_workspace_root`, `list_directory`, `open_document`, `resolve_local_document_link`, `read_workspace_asset`, `list_recent_documents` |
| N04 | `load_app_state`, `save_app_state` |
| N05 | `build_anchor` |
| N06 | `list_annotations`, `create_annotation`, `update_annotation`, `delete_annotation` |
| N07 | `list_comments`, `create_comment`, `update_comment`, `delete_comment` |
| N08 | `list_tags`, `create_tag`, `rename_tag`, `merge_tags`, `delete_tag`, `set_document_tags`, `set_annotation_tags` |
| N09 | `reanchor_document` |
| N10 | `list_orphans`, `manual_reanchor`, `convert_to_document_note` |
| A01 | `search_text` |
| A02 | `start_workspace_watch`, `stop_workspace_watch` |
| A03 | `rebuild_path_index`, `load_path_index` |
| A04 | `query_tagged_targets` |
| A05 | `list_backlinks`, `reindex_document_links` |
| A07 | `export_data` |

所有 list command 必須 deterministic sort。大集合必須 cursor pagination；禁止無界限回傳。

### 10.4 Tauri event

| Event | Payload 要點 |
|---|---|
| `workspace://tree-changed` | root_id、relative parent、event kind |
| `document://changed` | document_id、expected_revision、observed_source_hash |
| `document://missing` | document_id、last known path |
| `document://renamed` | document_id、old_rel_path、new_rel_path |
| `reanchor://completed` | document_id、revision、各 outcome 數量 |

事件只是通知，不是資料權威；UI 收到事件後必須透過 command/query 讀取最新狀態。

---

## 11. UI 與互動規格

### 11.1 文件樹

- Tree UI 只在展開時讀該層。
- `list_directory` 預設 limit 500，最大 1000；提供 cursor。
- `list_directory` 對 Markdown entry upsert document identity，並回傳穩定 document UUID；不得讀取正文。
- 同一 workspace 的 active roots 不得互為祖先/子孫或指向同一 canonical directory。
- A03 MAY 在 M4 建立獨立的背景 path index；該索引不得阻塞 tree 首屏，也不得改變 tree lazy-loading 語義。
- 單層超過 2000 項時 UI 顯示分頁/搜尋提示，不一次渲染全部。
- 預設擴展名：`.md`, `.markdown`, `.mdx`。
- MDX 不執行 JSX；未知 JSX 以文字或安全降級呈現。
- 預設忽略：`.git`, `node_modules`, `target`, `dist`, `.DS_Store`；使用 gitignore 語義。
- symlink 顯示但不可進入。
- 5000 文件 workspace 首屏可互動時間 `< 500 ms`。

### 11.2 標準連結與本地圖片

- `#heading` 在當前文件內捲動。
- 相對 `.md/.markdown/.mdx` 連結由 `resolve_local_document_link` 解析，只允許 exact relative/root path，不做 basename 猜測；合法 `../` 可在正規化後仍位於同 root 時使用。成功後以 document UUID 開 tab，若含 fragment 則在 render 後跳到 deterministic heading ID。
- `http/https/mailto` 只在使用者點擊時交由 OS 開啟。
- `file:`, `javascript:`, protocol-relative URL 與未知 scheme 一律拒絕。
- 相對本地圖片透過 `read_workspace_asset` 與 PathGuard 讀取，再以 binary response/stream 建立 Blob URL；禁止以 JSON number array 傳輸大 bytes，亦不得直接暴露任意 filesystem URL。
- 圖片 MIME whitelist：PNG、JPEG、GIF、WebP；以 magic bytes 驗證，不只信任副檔名或宣告 MIME；單檔上限 10 MiB。
- v1 阻擋 remote image、data URI 與本地 SVG；顯示安全 placeholder 與原始 alt text。
- Blob URL 在 document/tab 卸載時必須 revoke。
- CSP 至少包含 `img-src 'self' blob:`，不得加入任意 remote origin。

### 11.3 分頁

- 支援開啟、關閉、關閉其他、切換。
- 每 tab 保存 document UUID、捲動位置、最後 active 時間。
- 檔案 missing 時保留 tab 並顯示占位。
- 10 tab 切換無可感知阻塞。
- 恢復狀態不得觸發無界限同時讀檔；active tab 優先，其餘 lazy restore。

### 11.4 批注與高亮

- range annotation 可只有高亮而無正文。
- document note 必須有非空正文。
- 支援重疊 annotation；禁止直接建立互相交錯的巢狀 `<mark>`。
- 高亮 renderer 必須先收集所有 range boundary，切割 segment，再於 leaf span 掛 `data-annotation-ids`。
- 選中某 annotation 時可提升其視覺層級；未選中時使用 deterministic priority。
- 側欄按文檔位置排序；document note 固定在頂部分區；orphan 另列。
- 100 個 annotation 的重新渲染不得造成明顯卡頓。

### 11.5 留言

- 最多一層引用。
- 已刪留言顯示 tombstone，不顯示原正文。
- 回覆不得因 parent tombstone 而消失。
- 更新與刪除必須帶 row_version。

### 11.6 標籤

- autocomplete 使用 normalized match，顯示原 `display_name`。
- rename/merge 為單一 DB transaction。
- merge 後重複 binding 由 primary key 自動去重。
- `pin` 是不可 rename/delete 的 system tag，只可綁 document。
- 多標籤過濾使用 AND，且 AND 適用於同一 target；annotation hit 依 document 分組顯示。

### 11.7 搜尋與 palette

- 檔內搜尋在 canonical text 上執行，支援 regex、case-sensitive、whole-word。
- regex 編譯錯誤必須顯示，不得當作零結果。
- command palette 在可見文件索引上模糊匹配；5000 文件輸入響應 `< 30 ms`。
- 搜尋高亮與 annotation 高亮使用同一 interval segmentation，不得互相破壞 DOM mapping。

### 11.8 Mermaid

- 解析失敗時顯示原始 code block 與局部錯誤。
- 單一 Mermaid 失敗不得中止整份文件渲染。
- 支援縮放與平移。
- 不載入外部資源。

### 11.9 匯出

- 格式：Markdown、JSON。
- JSON 必須含 `schema_version`, workspace metadata、document identity/path、annotation、comment、tag、完整 AnchorV1、tombstone 選項。
- 先寫暫存檔，再以同檔案系統 atomic rename 完成。
- 目的地位於任一 workspace root 內即拒絕。
- v1 不實作 import，但 JSON schema 必須可供未來無損匯入。

---

## 12. 測試與品質門檻

### 12.1 測試金字塔

- Rust unit：
  - anchor capture、reanchor、tag normalization、PathGuard 純邏輯。
  - DB migration、trigger、transaction、不變量。
- Property test：
  - 在 exact 前後做隨機插入/刪除，且保持 exact 唯一時，結果必須仍 attached。
  - 路徑 traversal 與 Unicode path corpus。
- Frontend component：
  - lazy tree、tabs、selection mapping、overlap highlight、sidebar、orphan reselect。
- Contract test：
  - Rust/TS drift。
  - command request/response serialization golden files。
- E2E 最多 6 條：
  1. 選字 → 建批注 → 重開仍可見。
  2. 產生 orphan → 手動重錨 → 恢復。
  3. 重啟 → tabs 與 scroll 恢復。
  4. 文件/批注打標 → AND filter → 跳轉。
  5. 外部修改 → watcher → reanchor summary。
  6. 匯出 JSON/Markdown 且 workspace 零變更。

E2E 不在受限 sandbox CI 執行；在開發者 Terminal 或 release runner 執行並保存報告。

### 12.2 Fixture 與隱私

- repository fixture 必須為合成或去識別化資料。
- 禁止把私人 knowledge base 原文提交到 repo。
- 真實 KB dogfood 透過本機環境變數指定，不進版本控制。
- 測試至少覆蓋 CJK、emoji、combining mark、表格、list、code block、重複文字與 Mermaid。

### 12.3 性能預算

| 指標 | 預算 |
|---|---:|
| 冷啟動到可互動 | `< 1.5 s` |
| 1 MiB Markdown render model | `< 300 ms` |
| 5000 文件樹首屏 | `< 500 ms` |
| 1 MiB / 100 annotation 純 reanchor | `< 100 ms` |
| 10000 tag binding AND query | `< 50 ms` |
| 1 MiB 檔內搜尋 | `< 50 ms` |
| 5000 文件 palette keystroke | `< 30 ms` |

benchmark 必須記錄硬體、OS、build mode、資料集。CI benchmark 可採 regression warning；M3/M4 release gate 使用硬門檻。單文件 hard limit 為 20 MiB，超過時回 `DOCUMENT_TOO_LARGE` 並顯示原因。

### 12.4 CI

`make ci` MUST 包含：

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
core dependency boundary check
migration checksum/idempotency tests
make check-contracts
npm ci
npm run lint
npm run test
npm run build
docs graph/front-matter validation
```

production Rust 禁止無理由 `unwrap/expect`；允許測試使用。

### 12.5 觀測

- 日誌採 JSON lines。
- 每次 command 有 correlation ID、duration、result code。
- log rotation：每檔 10 MiB，保留 3 檔。
- crash hook 記錄 build info、OS、最後 20 個 command metadata；不得記錄正文。
- v1 無遠端上報。

---

## 13. 執行圖與里程碑

Machine-readable DAG：[`docs/graph.yaml`](docs/graph.yaml)。

| 里程碑 | 節點 | Gate |
|---|---|---|
| M0 地基 | N00, N01 | `make ci` 全綠；migration/invariant test 全綠；G2 記錄檔可寫入 |
| M1 能讀 | N02, N03, N04 | 連續 3 天用真實 KB 閱讀；性能預算達標 |
| M2 能標 | N05, N06, N07 | 至少 30 條真批注、10 條留言；重開皆可見 |
| M3 標不死 | N09, N10, A02 | 真實 git 變更回放；attached 比例 ≥ 90%；零遺失；所有 orphan 可恢復 |
| M4 能檢索 | N08, A01, A03, A04 | 標籤搜尋至少 3 次真實命中；原始核心需求閉環 |
| M4+ 收尾 | A05, A06, A07 | 各節點獨立驗收 |
| Bonus | 非目標候選 | 連續 14 天 dogfood 與全部核心 gate 通過 |

關鍵路徑：`N00 → N03 → N05 → N06 → N09 → N10 → A02`。

除收尾修復外，前一里程碑 dogfood gate 未通過時禁止啟動下一里程碑節點。

---

## 14. SDD 與 LLM 執行協議

完整協議見 [`docs/protocols/llm-execution-protocol.md`](docs/protocols/llm-execution-protocol.md)。

### 14.1 Node lifecycle

```text
todo
  → ready
  → specifying
  → contract-frozen
  → implementing
  → verifying
  → done
  ↘ blocked
  ↘ superseded
```

節點只有在所有 dependency `done`、node spec 完整、contract lock 存在、測試計畫可執行時，才可進入 `implementing`。

### 14.2 開發前必產出的衍生文檔

對每個 ready node，執行者 MUST 先產出：

1. `docs/tasks/{ID}/00-implementation-plan.md`
2. `docs/tasks/{ID}/01-test-plan.md`
3. 一組 `Txx-{slug}.md` 任務卡
4. `contracts/locks/{ID}.json`
5. 預期修改檔案清單與 ownership

任務卡規模 15–90 分鐘；一張卡只交付一個可驗證結果。任務卡不得跨越 node 邊界或自行新增產品能力。

### 14.3 文件先行與 TDD

- 實作前先建立失敗測試或明確的驗證腳本。
- PR 描述必須附 red → green 證據。
- 發現規格缺口時：
  1. 停止受影響子任務。
  2. 在 node spec 的 `spec_defects` 記錄。
  3. 只修改擁有該事實的權威文檔。
  4. 更新版本與 source hash。
  5. 重新生成受影響任務卡。
- 禁止把臨時決策只留在聊天、commit message 或程式註解。

### 14.4 預設裁決規則

執行中遇到未覆蓋邊界時，依序採用：

1. 保留使用者資料。
2. 拒絕模糊、自動猜測與靜默降級。
3. 維持 workspace 唯讀。
4. 維持向後相容資料遷移。
5. 選擇最小 command surface 與最小新依賴。
6. 選擇可被 unit/property test 驗證的純函數設計。
7. 不新增網路、權限、背景服務或非目標能力。
8. 若仍無法決定，建立 ADR；不得直接在程式碼中藏決策。

### 14.5 Ownership

- 每張任務卡必須列 `allowed_paths` 與 `forbidden_paths`。
- 多 agent 並行時，不得同時修改相同 implementation file。
- Contract file、migration order、root spec 屬治理 ownership，只有明確指派的 agent 可改。
- 執行者不得修改其 dependency 的已凍結 contract；需要變更時回到 contract review。

### 14.6 完成定義

節點 `done` 需要：

- Node BDD 全過。
- Node TDD/contract/invariant test 全綠。
- `make ci` 全綠。
- 性能與安全驗收有證據。
- verification report 已完成。
- contract drift 為零。
- node outcome 已追加到 JSONL。
- 沒有未記錄的規格偏差。
- Dogfood gate 所需證據可追溯。

---

## 15. G2 方法指標

每個節點完成時向 `docs/metrics/node-outcomes.jsonl` 追加一行：

```json
{
  "node_id": "N09",
  "spec_version": "1.0.1",
  "first_pass": false,
  "rework_category": "specification|test|execution|null",
  "rework_subtype": "optional-string",
  "spec_diff": "git-commit-or-null",
  "verification_report": "docs/verification/N09.md",
  "completed_at": "RFC3339"
}
```

`first_pass` 定義：第一個宣告「已完成實作並進入 verifying」的候選版本，是否在不修改 node requirements 與測試判準的情況下一次通過。

M4 後計算：

- 全節點一次通過率。
- 規格、測試、執行缺陷分布。
- 每類缺陷平均返工次數。
- N08 這個無 legacy implementation 的節點之單獨結果。

一次通過率 `>= 70%` 且沒有資料完整性事故，方可將此 SDD 模式推廣到下一專案。

---

## 16. 已裁決設計

以下決策為 v1 基線，執行者不得重新開放討論：

1. 新 repository 重建，legacy code 只按節點測試選擇性移植。
2. Anchor 以 canonical rendered text 為權威；同時保留 source span hint。
3. Tag 為扁平命名空間；`/` 無層級語義；使用 Unicode NFKC + case fold key。
4. Rename detection 納入 v1 watcher，但採唯一證據才自動遷移。
5. 文件刪除以 `missing` 表示；annotation/comment/document 不 hard delete。
6. `shifted/recovered` 是 audit event，不是長期 annotation state。
7. Polymorphic tag binding 不採用；文件與批注各自使用具 FK 的 binding table。
8. Comment 使用 tombstone 以保留引用關係。
9. render canonicalization 在 TypeScript 建立單一 pipeline；Rust 不重複解析 Markdown。
10. 路徑安全以 canonical component containment + 禁 symlink 實作，不使用字串 prefix。
11. v1 無網路與遙測。
12. 應用名稱與 repository slug 分別為 `Markdown Annotator`、`flowshot`。

---

## 17. Node 索引

| ID | 節點 | 文檔 |
|---|---|---|
| N00 | 專案骨架、CI、contract pipeline | [`docs/nodes/N00-foundation-ci-contracts.md`](docs/nodes/N00-foundation-ci-contracts.md) |
| N01 | SQLite schema 與 migration | [`docs/nodes/N01-sqlite-schema-migrations.md`](docs/nodes/N01-sqlite-schema-migrations.md) |
| N02 | Workspace 與 lazy file tree | [`docs/nodes/N02-workspace-lazy-tree.md`](docs/nodes/N02-workspace-lazy-tree.md) |
| N03 | Markdown render model | [`docs/nodes/N03-markdown-render-model.md`](docs/nodes/N03-markdown-render-model.md) |
| N04 | Tabs 與持久化狀態 | [`docs/nodes/N04-tabs-state.md`](docs/nodes/N04-tabs-state.md) |
| N05 | DOM selection 與 anchor capture | [`docs/nodes/N05-selection-anchor-capture.md`](docs/nodes/N05-selection-anchor-capture.md) |
| N06 | Annotation CRUD、sidebar、highlight | [`docs/nodes/N06-annotation-crud-highlight.md`](docs/nodes/N06-annotation-crud-highlight.md) |
| N07 | Comment thread | [`docs/nodes/N07-comment-thread.md`](docs/nodes/N07-comment-thread.md) |
| N08 | Tag system | [`docs/nodes/N08-tag-system.md`](docs/nodes/N08-tag-system.md) |
| N09 | Reanchor engine | [`docs/nodes/N09-reanchor-engine.md`](docs/nodes/N09-reanchor-engine.md) |
| N10 | Orphan management | [`docs/nodes/N10-orphan-management.md`](docs/nodes/N10-orphan-management.md) |
| A01 | In-document search | [`docs/nodes/A01-in-document-search.md`](docs/nodes/A01-in-document-search.md) |
| A02 | File watcher 與 rename | [`docs/nodes/A02-file-watcher-rename.md`](docs/nodes/A02-file-watcher-rename.md) |
| A03 | `rebuild_path_index`, `load_path_index` | [`docs/nodes/A03-command-palette.md`](docs/nodes/A03-command-palette.md) |
| A04 | Tag filter view | [`docs/nodes/A04-tag-filter-view.md`](docs/nodes/A04-tag-filter-view.md) |
| A05 | Wikilink 與 backlinks | [`docs/nodes/A05-wikilink-backlinks.md`](docs/nodes/A05-wikilink-backlinks.md) |
| A06 | Mermaid | [`docs/nodes/A06-mermaid.md`](docs/nodes/A06-mermaid.md) |
| A07 | Export | [`docs/nodes/A07-export.md`](docs/nodes/A07-export.md) |

---

## 18. 版本與變更控制

- 本文件採 semantic version。
- PATCH：不改行為的澄清。
- MINOR：向後相容的需求或 contract 擴充。
- MAJOR：資料模型、canonicalization、anchor 語義或 breaking contract 改動。
- 任何改動都必須：
  - 更新 changelog。
  - 更新受影響 node source hash。
  - 標記並重生失效的衍生文檔。
  - 若涉及已完成節點，附 regression plan。
- 聊天內容、issue 描述與 PR 描述不得凌駕本文件。
