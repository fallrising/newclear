---
document_id: GENERATED-COMPLETE-SDD
project: flowshot
version: 1.0.1
generated_from: flowshot-sdd-v1.0.1
status: generated-non-authoritative-export
---

# Flowshot / Markdown Annotator — Complete SDD Export

> This is a generated convenience export. The repository's `SPEC.md`,
> node specs, and Rust contracts remain authoritative. Do not edit this
> file directly.


---

# FILE: `SPEC.md`

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

---

# FILE: `docs/graph.yaml`

```yaml
schema_version: 1
project: flowshot
spec_version: 1.0.1
spec_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
critical_path:
- N00
- N03
- N05
- N06
- N09
- N10
- A02
nodes:
  N00:
    title: 專案骨架、CI 與 Contract Pipeline
    kind: core
    milestone: M0
    depends_on: []
    size: M
    status: blocked
    spec: docs/nodes/N00-foundation-ci-contracts.md
    contract_lock: contracts/locks/N00.json
    verification: docs/verification/N00.md
  N01:
    title: SQLite Schema、Migration 與 Repository
    kind: core
    milestone: M0
    depends_on:
    - N00
    size: M
    status: todo
    spec: docs/nodes/N01-sqlite-schema-migrations.md
    contract_lock: contracts/locks/N01.json
    verification: docs/verification/N01.md
  N02:
    title: Workspace、PathGuard 與 Lazy File Tree
    kind: core
    milestone: M1
    depends_on:
    - N00
    - N01
    size: M
    status: todo
    spec: docs/nodes/N02-workspace-lazy-tree.md
    contract_lock: contracts/locks/N02.json
    verification: docs/verification/N02.md
  N03:
    title: Deterministic Markdown Render Model
    kind: core
    milestone: M1
    depends_on:
    - N00
    size: M
    status: todo
    spec: docs/nodes/N03-markdown-render-model.md
    contract_lock: contracts/locks/N03.json
    verification: docs/verification/N03.md
  N04:
    title: 多分頁與狀態持久化
    kind: core
    milestone: M1
    depends_on:
    - N02
    - N03
    size: S
    status: todo
    spec: docs/nodes/N04-tabs-state.md
    contract_lock: contracts/locks/N04.json
    verification: docs/verification/N04.md
  N05:
    title: DOM Selection 到 Anchor Capture
    kind: core
    milestone: M2
    depends_on:
    - N03
    size: L
    status: todo
    spec: docs/nodes/N05-selection-anchor-capture.md
    contract_lock: contracts/locks/N05.json
    verification: docs/verification/N05.md
  N06:
    title: Annotation CRUD、Sidebar 與重疊高亮
    kind: core
    milestone: M2
    depends_on:
    - N01
    - N04
    - N05
    size: M
    status: todo
    spec: docs/nodes/N06-annotation-crud-highlight.md
    contract_lock: contracts/locks/N06.json
    verification: docs/verification/N06.md
  N07:
    title: Comment Thread 與 Tombstone 引用
    kind: core
    milestone: M2
    depends_on:
    - N06
    size: S
    status: todo
    spec: docs/nodes/N07-comment-thread.md
    contract_lock: contracts/locks/N07.json
    verification: docs/verification/N07.md
  N08:
    title: 扁平 Tag 系統與 System Pin
    kind: core
    milestone: M4
    depends_on:
    - N01
    - N04
    - N06
    size: M
    status: todo
    spec: docs/nodes/N08-tag-system.md
    contract_lock: contracts/locks/N08.json
    verification: docs/verification/N08.md
  N09:
    title: 純函數 Reanchor Engine 與批量交易
    kind: core
    milestone: M3
    depends_on:
    - N05
    - N06
    size: L
    status: todo
    spec: docs/nodes/N09-reanchor-engine.md
    contract_lock: contracts/locks/N09.json
    verification: docs/verification/N09.md
  N10:
    title: Orphan 列表與手動恢復
    kind: core
    milestone: M3
    depends_on:
    - N09
    size: M
    status: todo
    spec: docs/nodes/N10-orphan-management.md
    contract_lock: contracts/locks/N10.json
    verification: docs/verification/N10.md
  A01:
    title: 檔內搜尋
    kind: auxiliary
    milestone: M4
    depends_on:
    - N03
    - N06
    size: S
    status: todo
    spec: docs/nodes/A01-in-document-search.md
    contract_lock: contracts/locks/A01.json
    verification: docs/verification/A01.md
  A02:
    title: 檔案 Watcher、事件序列化與 Rename
    kind: auxiliary
    milestone: M3
    depends_on:
    - N02
    - N09
    size: M
    status: todo
    spec: docs/nodes/A02-file-watcher-rename.md
    contract_lock: contracts/locks/A02.json
    verification: docs/verification/A02.md
  A03:
    title: Command Palette
    kind: auxiliary
    milestone: M4
    depends_on:
    - N02
    - N04
    - A02
    size: M
    status: todo
    spec: docs/nodes/A03-command-palette.md
    contract_lock: contracts/locks/A03.json
    verification: docs/verification/A03.md
  A04:
    title: Tag AND Filter View
    kind: auxiliary
    milestone: M4
    depends_on:
    - N08
    size: S
    status: todo
    spec: docs/nodes/A04-tag-filter-view.md
    contract_lock: contracts/locks/A04.json
    verification: docs/verification/A04.md
  A05:
    title: Wikilink 與 Incremental Backlinks
    kind: auxiliary
    milestone: M4+
    depends_on:
    - N02
    - N03
    - A02
    size: M
    status: todo
    spec: docs/nodes/A05-wikilink-backlinks.md
    contract_lock: contracts/locks/A05.json
    verification: docs/verification/A05.md
  A06:
    title: 安全 Mermaid 渲染
    kind: auxiliary
    milestone: M4+
    depends_on:
    - N03
    size: S
    status: todo
    spec: docs/nodes/A06-mermaid.md
    contract_lock: contracts/locks/A06.json
    verification: docs/verification/A06.md
  A07:
    title: Annotation/Tag 匯出
    kind: auxiliary
    milestone: M4+
    depends_on:
    - N02
    - N06
    - N07
    - N08
    size: S
    status: todo
    spec: docs/nodes/A07-export.md
    contract_lock: contracts/locks/A07.json
    verification: docs/verification/A07.md
milestones:
  M0:
    title: 地基
    nodes:
    - N00
    - N01
    gate: make ci 全綠；migration/invariant test 全綠；G2 記錄機制可用
  M1:
    title: 能讀
    nodes:
    - N02
    - N03
    - N04
    gate: 連續 3 天真實 KB dogfood；閱讀與性能預算達標
  M2:
    title: 能標
    nodes:
    - N05
    - N06
    - N07
    gate: 至少 30 條真批注與 10 條留言；重開全部可見
  M3:
    title: 標不死
    nodes:
    - N09
    - N10
    - A02
    gate: git history replay attached>=90%；誤配=0；零資料遺失；orphan 可人工恢復
  M4:
    title: 能檢索
    nodes:
    - N08
    - A01
    - A03
    - A04
    gate: 標籤 AND 查詢真實命中至少 3 次；核心使用旅程閉環
  M4+:
    title: 收尾
    nodes:
    - A05
    - A06
    - A07
    gate: 各節點獨立 BDD、性能與安全驗收通過
scheduling_rules:
  ready_when:
  - all dependencies are done
  - the previous milestone gate permits this node
  - node spec source hash matches SPEC.md
  - file ownership does not overlap an active writer
  implementing_when:
  - implementation plan exists
  - test plan exists
  - contract lock exists and drift check passes
  - dependency evidence has been executed, not assumed
  max_parallel_nodes: unbounded by spec; file ownership must not overlap
  failure_loop_limit: 3
  milestone_gate_blocks_next_milestone: true
```

---

# FILE: `docs/protocols/llm-execution-protocol.md`

---
document_id: PROTOCOL-LLM-EXECUTION
version: 1.0.0
status: approved
authority: execution-process
---

# LLM Agent 執行協議

## 1. 目的

本協議將 SDD node 轉成可執行任務，並規定 LLM agent 在 contract、測試、程式碼、驗證與交接上的行為。Agent 的目標不是「寫最多程式碼」，而是以最小變更交付 node 的可驗證結果。

## 2. 啟動條件

Agent 只可領取 `docs/graph.yaml` 中符合以下條件的 node：

1. 所有 `depends_on` 狀態為 `done`。
2. Node front matter 的 `source_sha256` 等於目前 `SPEC.md` SHA-256。
3. Node 狀態為 `ready` 或被 orchestrator 明確指派。
4. Dependency contract 已凍結。
5. 沒有相同 `allowed_paths` 的其他 active owner。
6. 前一 milestone gate 已通過；收尾修復例外。

任一條不成立，agent 必須回報 blocker，不得以假設「依賴已完成」繼續。

## 3. 最小讀取集

開始前必讀：

1. `SPEC.md`。
2. 目標 node spec。
3. `docs/graph.yaml` 中直接 dependency。
4. 直接 dependency 的 contract 與 verification summary。
5. 本協議與 document change protocol。

不得把完整聊天紀錄、所有歷史 PR 或整個 legacy repo 當作必要上下文。需要 legacy 移植時，只讀 node `legacy_reference` 指向的局部模組。

## 4. 規格檢查 Gate

在產生程式碼前，agent 必須寫出：

- Node objective 的一句話重述。
- 所有輸入、輸出與不變量。
- 可執行 BDD 清單。
- 未定義詞、矛盾、缺少 contract、缺少測試 oracle。
- 前置事實證據：dependency build/test/contract 實際可用。

若存在 material ambiguity：

1. 在 implementation plan 加 `spec_defects`。
2. 停止受影響 task。
3. 修改擁有該事實的權威文件，或建立 ADR。
4. 更新版本、hash 與所有失效衍生文檔。
5. 不得只在程式碼選一個行為。

`SPEC.md` 已提供預設裁決規則；能依該規則唯一推出答案時可直接採用，但必須在 plan 記錄推導。

## 5. 衍生文檔順序

每個 node 必須依序產生：

```text
docs/tasks/{ID}/
├── 00-implementation-plan.md
├── 01-test-plan.md
├── T01-*.md
├── T02-*.md
└── ...
contracts/locks/{ID}.json
docs/verification/{ID}.md   # 完成時
```

### 5.1 Implementation plan

必須包含：

- 現況盤點與可重用代碼。
- 架構切面與資料流。
- Contract 清單。
- Migration 影響。
- 風險與 failure injection。
- 檔案 ownership。
- Task DAG。
- Rollback/revert strategy。
- 明確非範圍。

### 5.2 Test plan

必須把每條 BDD 映射到自動測試或人工 gate，並列出：

- Test level。
- Fixture。
- Oracle。
- Red state。
- Green condition。
- Negative/failure case。
- Performance/security evidence。
- 執行命令。

### 5.3 Task card

每張 task：

- 15–90 分鐘。
- 一個主要結果。
- 一組明確 allowed paths。
- 一個可單獨運行的驗證。
- 不跨 node。
- 不修改已凍結 dependency。
- 沒有「順便重構」。

若一張 task 需要同時改 contract、migration、backend、frontend、E2E，必須再拆。

## 6. Contract Freeze

1. 先寫 Rust request/response/error DTO。
2. 生成 TypeScript。
3. 寫 serialization golden test。
4. 建立 `contracts/locks/{ID}.json`：
   - node ID。
   - contract source files。
   - SHA-256。
   - command names。
   - frozen_at。
5. `make check-contracts` 全綠後才能進入 implementation。

Contract freeze 不是永久禁止變更；它要求任何變更先回寫 node spec、tests 與 lock。已完成 dependency 的 breaking change 必須 ADR。

## 7. TDD 執行

每張 task 的最小循環：

1. 寫失敗測試或可重現 failure script。
2. 保存 red 證據：命令、失敗摘要、對應 requirement。
3. 寫最小實作。
4. 跑局部測試。
5. 跑 dependency contract tests。
6. 重構但不改行為。
7. 跑 `make ci`。
8. 更新 task status 與 evidence。

不接受「測試與實作同時完成、無法證明 red」作為 G2 一次通過證據。

## 8. Failure Loop

同一 acceptance failure 最多進行三輪：

1. 診斷：先分類 spec/test/execution。
2. 最小修復。
3. 重跑原始 oracle，不換判準。

第三輪仍失敗：

- 將 node 標為 `blocked`。
- 提交 diagnosis、已排除原因、剩餘假設。
- 由 orchestrator 決定：新增 task、改 dependency、修改 spec、回退或推翻局部設計。
- 執行 agent 不得自行弱化驗收。

## 9. 多 Agent Ownership

- Orchestrator 以 task card 的 `allowed_paths` 分配 ownership。
- 同一時間一個 implementation file 只能有一個 writer。
- Read-only 檢查不需要 ownership。
- Shared files 分三類：
  - `SPEC.md`、graph、ADR：governance owner。
  - Contract/migration order：contract owner。
  - Generated files：generator owner；其他 agent 禁止手改。
- Agent 完成時輸出 handoff：
  - 做了什麼。
  - 變更檔案。
  - 驗證證據。
  - 風險與已知限制。
  - 下一個 ready task。
  - 未解 blocker。

Agent 間不以聊天記憶作交接；只以 repository artifacts 交接。

## 10. 程式碼變更限制

Agent 禁止：

- 寫入 workspace 源文件。
- 新增網路、遙測、帳號、AI、editor 等非目標能力。
- 引入第二套 Markdown canonicalizer。
- 在 frontend 直接讀 filesystem。
- 使用 polymorphic tag FK。
- 將 orphan 自動刪除或模糊配對。
- 修改 threshold、canonicalization 或 schema 語義而不寫 ADR。
- 為通過測試移除/放寬 oracle。
- 在 production path 使用無理由 `unwrap/expect`。
- 大型無關重命名、格式化或重構。

## 11. Verification

Node 進入 `verifying` 後，由與主要實作者不同的 reviewer 或獨立 agent 執行：

1. 規格軸：逐條 requirement/BDD 對證據。
2. 架構軸：dependency boundary、資料一致性、concurrency、安全。
3. 對抗軸：錯誤輸入、事件風暴、race、ambiguous candidate、failure injection。
4. 回歸軸：dependency tests 與 `make ci`。
5. Dogfood/性能軸：必要的真實資料 gate。

Verification report 必須列出完整命令與結果，不接受「看起來可用」。

## 12. 完成與指標

通過 verification 後：

- Node status 改 `done`。
- 追加 `docs/metrics/node-outcomes.jsonl`。
- `first_pass` 按 `SPEC.md` 定義記錄。
- 若返工，填 top-level category：
  - `specification`
  - `test`
  - `execution`
- 更新 graph 狀態。
- 評估是否解鎖 downstream node。
- 若完成 milestone 最後節點，執行 dogfood gate；未通過不得開下一 milestone。

---

# FILE: `docs/protocols/document-change-control.md`

---
document_id: PROTOCOL-DOCUMENT-CHANGE
version: 1.0.1
status: approved
authority: documentation-governance
---

# 文檔變更、派生與 Drift 管理

## 1. 單一權威原則

「SSOT」不表示所有內容必須塞在一個檔案；它表示同一事實只能由一個檔案擁有。

- 全局事實由 `SPEC.md` 擁有。
- Node 事實由對應 node spec 擁有。
- Command/DTO 由 Rust contract 擁有。
- Task doc 只能引用，不得創造產品需求。
- Verification doc 只能記證據，不得改驗收標準。

## 2. 修改分類

| 變更 | 必改文件 | 版本影響 |
|---|---|---|
| 文句澄清、無行為改變 | 原權威文件 | PATCH |
| 新增向後相容能力 | SPEC/node/contract/tests | MINOR |
| Canonicalization、schema、anchor 或 breaking API | ADR + SPEC + affected nodes | MAJOR |
| 實作細節、無 contract/行為改變 | implementation plan/task | 不改 SPEC |
| 測試 oracle 修正 | node spec/test plan，記 test defect | 視行為影響 |
| Dependency 前提改變 | graph + affected nodes | 至少 PATCH |

## 3. Source Hash

所有衍生文檔 front matter：

```yaml
derived_from:
  - ../../SPEC.md
  - ../../nodes/N09-reanchor-engine.md
source_version: {SPEC_VERSION}
source_sha256:
  SPEC.md: ...
  N09: ...
generated_at: RFC3339
```

CI 計算實際 hash。任一不符：

- 文檔狀態改為 `stale`。
- 對應 task 不得進入 implementation。
- 重新生成後必須人工確認差異，不得盲目覆蓋執行記錄。

## 4. Node Spec 變更

Node 開始前可直接修訂，但必須：

1. 說明原因。
2. 更新 version 或 `revision`。
3. 更新 contract/test plan。
4. 重新凍結 lock。

Node `implementing` 後修改 requirement：

- 記錄 `specification` rework。
- 暫停受影響 task。
- 保留舊版本 diff。
- 重新驗證所有受影響已完成 task。

Node `done` 後修改 requirement：

- 建立新 node 或 ADR。
- 不覆寫原 verification report。
- 需要 migration/backfill 時另建節點。

## 5. ADR 觸發條件

以下必須 ADR：

- 改 canonicalization/pipeline version。
- 改 AnchorV1 schema、threshold、margin、offset unit。
- 改 document identity/rename policy。
- 改 soft-delete/hard-delete policy。
- 改 SQLite schema 破壞性語義。
- 新增網路、權限、background service。
- Breaking command contract。
- 修改 v1 非目標或 Bonus Gate。

ADR 狀態：`proposed → accepted/rejected → superseded`。Rejected ADR 保留，防止相同問題反覆討論。

## 6. Contract Drift

- Rust source 是權威。
- Generated TypeScript、wrapper、manifest 必須可重現。
- 生成物 header 包含 generator version 與 source hash。
- 手動編輯生成物由 CI 阻斷。
- Lock file 只由 contract freeze 流程更新。
- Downstream node pin dependency contract hash；hash 變動即 stale。

## 7. Migration Drift

每個 migration：

- 單調版本。
- 不可修改已發布 migration；修正以新 migration。
- 有 checksum。
- 有空庫與逐版升級 test。
- 破壞性 migration 必須 backup/recovery plan。
- Schema 文檔與 migration 差異由 test/inspection 阻斷。

## 8. 狀態與歷史

禁止刪除或重寫：

- 已接受 ADR。
- 已完成 verification report。
- `node-outcomes.jsonl` 歷史行。
- 已發布 migration。
- Anchor event audit。

修正以新記錄追加，保留可追溯性。

## 9. PR/Commit 規則

每個 node PR 至少包含：

- Node/task ID。
- Requirement/BDD mapping。
- Contract hash。
- Red → green 證據。
- Verification 命令。
- Spec/test/execution defect 記錄。
- 無 scope expansion 聲明。

Commit 可按 task 切分。不要把多個無依賴 node 混在同一 PR。

---

# FILE: `docs/nodes/A01-in-document-search.md`

---
id: A01
title: 檔內搜尋
kind: auxiliary
milestone: M4
status: todo
depends_on: 
  - N03
  - N06
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread in-document search
allowed_paths: 
  - crates/core/src/search/**
  - crates/core/src/contracts/A01*
  - src-tauri/src/commands/search*
  - src/features/search/**
  - contracts/locks/A01.json
  - docs/tasks/A01/**
  - docs/verification/A01.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A01 — 檔內搜尋

## 目標

在 canonical text 上提供安全、可預測的檔內搜尋，支援 literal/regex、大小寫、全字與上下跳轉，並與 annotation interval renderer 共存。

## 輸入與前置條件

- N03 canonical text/segments。
- N06 interval renderer 若已完成則整合；可先以 adapter 開發。

## 範圍與交付物

- 使用 Rust `regex` 類線性時間引擎執行 regex；不使用可 catastrophic backtracking 的主執行緒 JS RegExp。
- literal、case-sensitive、whole-word、regex。
- 結果回 UTF-8 byte ranges。
- UI 顯示結果數、current index、next/previous。
- 搜尋 layer 與 annotation layer共用 interval segmentation。
- 無效/不支援 regex 語法顯示錯誤。

## Contract

新增：

```text
search_text({
  canonical_text,
  query,
  mode: "literal" | "regex",
  case_sensitive,
  whole_word,
  max_results
}) -> { ranges, truncated }
```

`max_results` 預設 1000、最大 5000。

## 實作約束

- Search result 只對目前 canonical hash 有效；hash 變更即丟棄。
- Regex syntax 以選定 Rust engine 為準，UI 要說明不支援 backreference/lookaround（若 engine 不支援）。
- 不在 main UI thread 做無界限 regex。
- Range 必須 UTF-8 boundary。
- max_results 防止巨大 DOM。

## BDD 場景

**Given** invalid regex  
**When** 搜尋  
**Then** 顯示具體 pattern error，不崩潰、不當作零結果。

**Given** annotation 與 search range overlap  
**When** 切換結果  
**Then** annotation 仍可點選，DOM mapping 不失效。

## 測試計畫

- Literal/regex/case/whole-word table tests。
- Unicode/CJK boundary tests。
- Invalid pattern tests。
- 1 MiB benchmark。
- Overlap layer component test。

## 驗收標準

- 1 MiB 常見查詢 `< 50 ms`。
- Invalid regex 安全。
- Result navigation deterministic。

## 性能與觀測

- Command 記錄 pattern length、result count、duration，不記 pattern 原文。

## 非範圍

- 跨文件全文索引。
- Replace。

## 建議衍生任務

1. `T01-search-contract`
2. `T02-core-search-engine`
3. `T03-search-ui`
4. `T04-highlight-layer-integration`
5. `T05-performance-tests`

## Legacy 移植規則

可參考 legacy UX；搜尋語義與 offset 必須改用 canonical text。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A01.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/A02-file-watcher-rename.md`

---
id: A02
title: 檔案 Watcher、事件序列化與 Rename
kind: auxiliary
milestone: M3
status: todo
depends_on: 
  - N02
  - N09
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread notify watcher
  - loom rename-storm compensation
allowed_paths: 
  - src-tauri/src/watcher/**
  - src-tauri/src/events/**
  - crates/core/src/contracts/A02*
  - crates/db/src/repositories/documents*
  - src/features/watcher/**
  - contracts/locks/A02.json
  - docs/tasks/A02/**
  - docs/verification/A02.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A02 — 檔案 Watcher、事件序列化與 Rename

## 目標

監聽 workspace 變更，將 atomic-save 事件風暴收斂為每文件序列事件，安全觸發重新 render/reanchor，並在證據唯一時遷移 rename。

## 輸入與前置條件

- N02 document identity/PathGuard。
- N09 revision transaction/reanchor。
- `SPEC.md` §7。

## 範圍與交付物

- start/stop workspace watcher。
- 500 ms quiet debounce、2 s max wait。
- canonical path coalescing。
- per-document single queue，跨 document 可並行。
- observed hash unchanged fast ignore；watcher 不覆寫 committed hash/revision，讀取不穩定時延後重試而非發布半成品事件。
- changed/missing/renamed/tree events。
- rename pair 優先；唯一 hash fallback 5 秒窗。
- ambiguity 不自動遷移。
- atomic save storm integration tests。
- UI 狀態提示與 reanchor summary。
- 建立 concurrency state-machine test；可附小型 TLA+ 模型但非硬 gate。

## Contract

新增：

```text
start_workspace_watch({ workspace_id })
stop_workspace_watch({ workspace_id })
```

事件 payload 依 `SPEC.md` §10.4。Event 只通知；UI 必須重新 query。

## 實作約束

- Watcher 不直接產生 canonical text。
- 同 document job 不並行。
- Revision conflict 必須重讀/重跑最新版本。
- Rename 只有唯一證據才更新同 document UUID。
- Missing 不刪 document/annotation。
- Symlink 忽略。
- Watcher shutdown 必須取消 task 並 flush 或安全丟棄未提交 job。

## BDD 場景

### 外部保存

**Given** 外部編輯器 atomic save 已開文件  
**When** 事件風暴結束  
**Then** 2 秒內 UI 刷新，只有一次穩定 reanchor commit。

### Git mv

**Given** 文件被 `git mv` 且 rename pair/唯一 hash 成立  
**When** watcher 收到事件  
**Then** 同一 document UUID 更新 rel_path，annotation 跟隨。

### Ambiguous copy

**Given** 同 hash 有兩個新候選  
**When** 舊文件 missing  
**Then** 不自動 rename，舊 document 保持 missing。

## 測試計畫

- Tempdir watcher integration：write、atomic rename、delete、restore、git-mv-like。
- Event coalesce deterministic tests。
- Per-document queue concurrency。
- Revision conflict retry。
- Ambiguous hash no-migrate。
- Shutdown cleanup。

## 驗收標準

- 三個 BDD 全過。
- 外部保存到 UI summary `< 2 s`。
- 無 duplicate/overwriting anchor event。
- Rename 誤遷移為 0。

## 性能與觀測

- 事件 storm 1000 events 不造成 1000 reanchor。
- 記錄 raw/coalesced/job counts 與 durations。

## 非範圍

- Remote filesystem。
- Symlink follow。
- 自動合併 ambiguous rename。

## 建議衍生任務

1. `T01-watcher-contract`
2. `T02-event-coalescer`
3. `T03-document-job-queue`
4. `T04-hash-and-missing-flow`
5. `T05-rename-resolution`
6. `T06-ui-events`
7. `T07-storm-concurrency-tests`

## Legacy 移植規則

可移植 legacy notify adapter 與 rename-storm測試案例；新 identity/revision規則必須重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A02.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/A03-command-palette.md`

---
id: A03
title: Command Palette
kind: auxiliary
milestone: M4
status: todo
depends_on: 
  - N02
  - N04
  - A02
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread command palette
allowed_paths: 
  - src/features/palette/**
  - src-tauri/src/path_index/**
  - src-tauri/src/commands/path_index*
  - crates/core/src/contracts/A03*
  - crates/db/src/repositories/documents*
  - docs/tasks/A03/**
  - docs/verification/A03.md
  - contracts/locks/A03.json
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A03 — Command Palette

## 目標

提供鍵盤優先的文件快速開啟入口，並建立可擴充但不過度抽象的 action registry。

## 輸入與前置條件

- N02 workspace/document identity。
- A02 tree change event。
- N04 tab open action（整合時）。

## 範圍與交付物

- `rebuild_path_index` 以背景 traversal 只讀取 path/metadata、遵守 ignore/PathGuard，upsert document identity；不得阻塞 tree 首屏。
- `load_path_index` 一次載入已建立的本地 path index；支援 index version。
- A02 tree event 增量更新/標記 index stale。
- `⌘K` 開啟 palette。
- 文件名、相對路徑模糊匹配。
- deterministic subsequence scorer；同分以最近開啟、路徑排序。
- 鍵盤上/下、Enter、Esc。
- Action registry 僅定義 `id/title/keywords/execute`，v1 先註冊 open file。
- 5000 文件本地索引；index 未完成時顯示進度並仍可搜尋已發現文件。

## Contract

新增：

```text
rebuild_path_index({ workspace_id }) -> { index_version, indexed_files, duration_ms }
load_path_index({
  workspace_id,
  index_version?,
  cursor?,
  limit?
}) -> { index_version, entries, next_cursor }
```

`limit` 預設 5,000、最大 10,000；v1 workspace hard limit 100,000 indexed Markdown entries，超過時回明確錯誤並要求縮小 roots。載入多頁期間若 index version 改變，frontend 丟棄舊頁並重新開始。Contract 同時鎖定前端 action interface。

## 實作約束

- 不掃描未授權/ignored 路徑。
- 每次 keystroke 不觸發 filesystem IO。
- Background index 不能改變 N02 tree 的 lazy 行為，且可取消。
- 只有完整掃描成功後才能以本輪 seen-set 標記未見 documents 為 missing；取消/失敗不得批量改狀態。
- Index traversal 不讀正文、不跟隨 symlink。
- 不引入完整 plugin system。
- 搜尋結果 deterministic。

## BDD 場景

**Given** 5000 文件索引
**When** 連續輸入查詢
**Then** 每次響應 `< 30 ms`，Enter 開啟正確文件。

**Given** ignored 文件
**When** 查詢其名稱
**Then** 不出現在結果。

**Given** path index 尚在建立
**When** 使用者開啟 palette
**Then** 可搜尋已完成部分並看到進度，不阻塞主 UI。

## 測試計畫

- Scorer table tests。
- Tie-break determinism。
- Keyboard/a11y component。
- 5000 item benchmark。
- Open action integration。
- Background traversal cancellation、ignore、symlink、A02 stale update tests。

## 驗收標準

- `< 30 ms`。
- 全鍵盤可用。
- 不產生 IO burst。

## 性能與觀測

- 記錄 index size與查詢 duration，不記 query 原文。

## 非範圍

- 任意腳本、plugin、自然語言命令。

## 建議衍生任務

1. `T01-path-index-contract`
2. `T02-background-index-builder`
3. `T03-action-interface-and-scorer`
4. `T04-palette-ui`
5. `T05-watcher-incremental-update`
6. `T06-performance-a11y`

## Legacy 移植規則

可移植 legacy palette UI；scorer與 registry需符合本節點最小接口。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A03.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/A04-tag-filter-view.md`

---
id: A04
title: Tag AND Filter View
kind: auxiliary
milestone: M4
status: todo
depends_on: 
  - N08
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: []
allowed_paths: 
  - crates/db/src/repositories/tag_query*
  - crates/core/src/contracts/A04*
  - src-tauri/src/commands/tag_query*
  - src/features/tag-filter/**
  - contracts/locks/A04.json
  - docs/tasks/A04/**
  - docs/verification/A04.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A04 — Tag AND Filter View

## 目標

以多標籤 AND 語義查詢 document 與 annotation target，分頁展示並可跳轉到文件或 anchor。

## 輸入與前置條件

- N08 tag/binding。
- N04/N06 navigation target。

## 範圍與交付物

- `query_tagged_targets`，文件與 annotation 分別查詢。
- SQL 使用 GROUP BY/HAVING COUNT(DISTINCT tag_id)=N。
- 排除 archived root 與 deleted annotation；missing document 仍回傳並標記 status，以保留可追溯性。
- Annotation 結果依 document 分組，回 anchor status/position。
- Multi-select tag UI、cursor pagination。
- 點 document 開 tab；點 annotation 開 tab 並定位，orphan 則開 sidebar/orphan context。

## Contract

```text
query_tagged_targets({
  tag_ids,
  target_types: ["document"|"annotation"],
  cursor?,
  limit?
}) -> { documents, annotations, next_cursor }
```

## 實作約束

- AND 對同一 target 成立，不把 document tag 與其 annotation tag混算。
- tag_ids 空集合顯示空/提示，不等同全庫。
- deterministic sort。
- 查詢必須使用 index，不做 application-side全量 filter。

## BDD 場景

**Given** 選擇 `terraform` + `rds`
**When** 查詢
**Then** 只回同一 target 同時具有兩 tag 的結果。

**Given** annotation orphan
**When** 點結果
**Then** 開文件與 orphan context，不假裝可高亮。

## 測試計畫

- SQL result semantics。
- Duplicate tag input normalization。
- Deleted annotation 排除；missing document 保留並標記。
- Cursor determinism。
- 10,000 bindings benchmark。
- Navigation component。

## 驗收標準

- AND 語義準確。
- 10,000 bindings `< 50 ms`。
- document/annotation 跳轉閉環。

## 性能與觀測

- Query plan入verification report。
- 日誌只記 tag count/result count。

## 非範圍

- OR/NOT、saved queries、tag hierarchy。

## 建議衍生任務

1. `T01-query-contract`
2. `T02-document-and-annotation-sql`
3. `T03-pagination`
4. `T04-filter-ui`
5. `T05-navigation-and-benchmark`

## Legacy 移植規則

全新實作。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A04.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/A05-wikilink-backlinks.md`

---
id: A05
title: Wikilink 與 Incremental Backlinks
kind: auxiliary
milestone: M4+
status: todo
depends_on: 
  - N02
  - N03
  - A02
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread wikilink/backlinks
allowed_paths: 
  - src/lib/document-model/plugins/wikilink*
  - crates/db/migrations/*document_links*
  - crates/db/src/repositories/links*
  - crates/core/src/contracts/A05*
  - src-tauri/src/commands/links*
  - src/features/backlinks/**
  - contracts/locks/A05.json
  - docs/tasks/A05/**
  - docs/verification/A05.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A05 — Wikilink 與 Incremental Backlinks

## 目標

解析 `[[target]]` 與 `[[target|alias]]`，保守解析文件目標並維護增量 backlink index；歧義不得自動選擇。

## 輸入與前置條件

- N02 document identity/path。
- N03 AST pipeline。
- A02 change notification。

## 範圍與交付物

- Markdown AST plugin 解析 wikilink，不以 regex 直接改 HTML。
- 新 migration `document_links`：source_document_id、raw_target、alias、target_document_id nullable、resolution、source range、source revision。
- Resolution 順序：
  1. current document directory relative exact path（補常見 extension）。
  2. root-relative exact path。
  3. workspace 內唯一 basename。
  4. 無或多候選 → broken/ambiguous。
- 開啟/變更文件只重建該 source document 的 links。
- Backlinks panel。
- Broken/ambiguous 樣式與候選提示。

## Contract

新增：

```text
reindex_document_links({ document_id, expected_revision, links })
list_backlinks({ document_id, cursor?, limit? })
```

Link parser output使用 canonical/source ranges與raw target。

## 實作約束

- 不全量掃 workspace 來更新單文件。
- Ambiguous 不自動選。
- ignored/missing document 不作可開啟 target。
- Link reindex transaction replaces one source document snapshot。
- 不執行 URI 或任意 HTML。

## BDD 場景

**Given** `[[notes/foo]]` 有唯一相對路徑
**When** render
**Then** 可點開正確 document並建立 backlink。

**Given** `[[foo]]` 有兩個 basename候選
**When** render
**Then** 標為 ambiguous，不自動選。

**Given** source document外部修改刪除 link
**When** A02觸發增量 reindex
**Then** backlink移除，其他文件不重掃。

## 測試計畫

- AST parser fixtures。
- Resolution table tests。
- Ambiguity tests。
- Incremental replace transaction。
- Rename/missing integration。
- Backlink UI。

## 驗收標準

- 無錯誤自動解析 ambiguous link。
- A02增量更新成立。
- Backlink查詢分頁與 deterministic。

## 性能與觀測

- 單文件 reindex隨該文件 link數線性。
- 不因一文件變更全庫掃描。

## 非範圍

- Graph visualization。
- Heading/block reference。
- Transclusion/embed。

## 建議衍生任務

1. `T01-link-ast-plugin`
2. `T02-document-links-migration`
3. `T03-resolver`
4. `T04-incremental-reindex`
5. `T05-backlink-panel`
6. `T06-rename-and-ambiguity-tests`

## Legacy 移植規則

可移植 legacy resolver案例；資料表與 incremental transaction按本規格重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A05.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/A06-mermaid.md`

---
id: A06
title: 安全 Mermaid 渲染
kind: auxiliary
milestone: M4+
status: todo
depends_on: 
  - N03
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread Mermaid rendering
allowed_paths: 
  - src/features/mermaid/**
  - src/lib/document-model/plugins/mermaid*
  - docs/tasks/A06/**
  - docs/verification/A06.md
  - contracts/locks/A06.json
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A06 — 安全 Mermaid 渲染

## 目標

將 `lang=mermaid` code block 以本地、安全、局部失敗的方式渲染為可縮放圖形。

## 輸入與前置條件

- N03 code block AST與安全 HTML。

## 範圍與交付物

- 偵測 Mermaid code block。
- Lazy render：進入 viewport 或展開時才初始化。
- 使用本地 bundle、strict security。
- 成功顯示 SVG；失敗保留原始 code與錯誤。
- 縮放、平移、reset。
- 主題與應用 light/dark 同步，但輸出 deterministic snapshot不以時間/random id。

## Contract

無 Tauri command。凍結前端 `MermaidBlock` props與error type。

## 實作約束

- 禁止外部資源、HTML label、script、click callback。
- 單 block錯誤不得中止全文。
- SVG sanitize後插入。
- 不把 diagram source寫日誌。

## BDD 場景

**Given** 合法 diagram
**When** block進入 viewport
**Then** 顯示可縮放圖。

**Given** 非法 diagram
**When** render
**Then** 局部錯誤+source fallback，文件其他部分正常。

## 測試計畫

- 合法/非法diagram fixtures。
- Security corpus。
- Lazy render component。
- Zoom/pan/reset。
- Deterministic ID snapshot。

## 驗收標準

- 兩個 BDD全過。
- 無網路 request。
- 錯誤隔離。

## 性能與觀測

- 未進 viewport不初始化。
- 單圖render duration可觀測，不記source。

## 非範圍

- PlantUML。
- 編輯器、server rendering。

## 建議衍生任務

1. `T01-mermaid-block-contract`
2. `T02-secure-renderer`
3. `T03-lazy-ui-and-controls`
4. `T04-error-fallback`
5. `T05-security-tests`

## Legacy 移植規則

可移植 legacy UI；安全設定與 deterministic ID需重新驗證。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A06.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/A07-export.md`

---
id: A07
title: Annotation/Tag 匯出
kind: auxiliary
milestone: M4+
status: todo
depends_on: 
  - N02
  - N06
  - N07
  - N08
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: []
allowed_paths: 
  - crates/core/src/export/**
  - crates/core/src/contracts/A07*
  - src-tauri/src/commands/export*
  - src/features/export/**
  - docs/export-schema/**
  - contracts/locks/A07.json
  - docs/tasks/A07/**
  - docs/verification/A07.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A07 — Annotation/Tag 匯出

## 目標

將 annotation、comment、tag 與 AnchorV1 安全匯出為 Markdown 或版本化 JSON，使用 workspace 外目的地與 atomic write。

## 輸入與前置條件

- N06 annotation/comment資料。
- N08 tag資料。
- N02 PathGuard/root清單。

## 範圍與交付物

- 篩選：workspace、documents、tags。
- Format：Markdown、JSON。
- JSON schema version 1，含 document UUID/path/status、committed document model version、annotation/comment/tag/anchor/event可選。
- 選項 include_deleted。
- Markdown以document分組，range annotation含quoted exact與comment thread。
- 使用系統save dialog。
- Export destination guard。
- temp file + fsync（平台可行時）+ atomic rename。
- 建立JSON parser/round-trip contract test，雖v1不提供import UI。

## Contract

新增：

```text
export_data({
  selection,
  format: "markdown" | "json",
  destination_path,
  include_deleted: false,
  include_anchor_events: false
}) -> { bytes_written, item_counts, schema_version }
```

## 實作約束

- 目的地在任何workspace root內即拒絕。
- 不修改source Markdown。
- Export失敗不得留下看似完整的目標檔；暫存檔要清理。
- JSON field與enum stable。
- 絕對path預設可選擇redact為workspace-relative；預設不輸出root abs path。

## BDD 場景

**Given** destination在workspace內
**When** export
**Then** 回 `EXPORT_PATH_FORBIDDEN`，workspace零變更。

**Given** export JSON完成
**When** 用schema parser讀回
**Then** annotation/comment/tag/anchor無損。

**Given** 中途寫入失敗
**When** command結束
**Then** 無部分完成的target file。

## 測試計畫

- PathGuard export reverse containment。
- JSON schema/golden/round-trip parser。
- Markdown snapshot。
- Failure injection atomic write。
- include_deleted semantics。
- E2E #6。

## 驗收標準

- 三個BDD全過。
- E2E #6綠。
- JSON可未來無損import。
- Workspace git diff/mtime證明零寫入。

## 性能與觀測

- 10000 annotation export應串流或有界內存；verification記peak memory。
- 日誌只記counts/bytes/path相對摘要。

## 非範圍

- Import UI。
- 自動備份排程。
- 雲端上傳。

## 建議衍生任務

1. `T01-export-contract-and-schema`
2. `T02-export-query`
3. `T03-json-serializer-parser`
4. `T04-markdown-renderer`
5. `T05-safe-atomic-write`
6. `T06-ui-and-e2e`

## Legacy 移植規則

全新實作。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A07.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N00-foundation-ci-contracts.md`

---
id: N00
title: 專案骨架、CI 與 Contract Pipeline
kind: core
milestone: M0
status: blocked
depends_on: []
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread repository layout
  - loom contract-first CI pattern
allowed_paths: 
  - Cargo.toml
  - Cargo.lock
  - crates/core/**
  - crates/db/**
  - crates/xtask/**
  - src-tauri/**
  - src/**
  - Makefile
  - README.md
  - .gitignore
  - index.html
  - package.json
  - package-lock.json
  - tsconfig*.json
  - vite.config.ts
  - vitest.config.ts
  - eslint.config.js
  - .github/**
  - contracts/**
  - docs/tasks/N00/**
  - docs/verification/N00.md
  - docs/metrics/node-outcomes.jsonl
  - docs/graph.yaml
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N00 — 專案骨架、CI 與 Contract Pipeline

## 目標

建立可重現的 Tauri 2 + React 19 工程骨架，讓後續每個節點都有一致的編譯、測試、contract generation、dependency boundary 與 CI gate。

## 輸入與前置條件

- `SPEC.md` §4、§10、§12。
- 開發機已具 Rust stable、Node LTS、Tauri 所需平台依賴。
- 本節點無功能 dependency。

## 範圍與交付物

- 建立 Tauri 2 + React 19 + TypeScript + Vite 空應用。
- 建立 Rust workspace：`crates/core`、`crates/db`、`crates/xtask` 與 `src-tauri`。
- 建立 `core::contracts` 基礎 trait/型別與 `xtask contracts`。
- 生成 TypeScript DTO、typed invoke wrapper、command manifest。
- 建立 `make bootstrap`, `make gen-contracts`, `make check-contracts`, `make ci`。
- 建立 dependency boundary check，阻止 `core` 依賴 Tauri、rusqlite、IO adapter。
- 建立 lint、format、unit/component/build CI。
- 實作 `get_build_info` 作為第一個完整 contract → command → TS wrapper 範例。
- README 的全新 checkout 啟動步驟不得超過五條命令。

## Contract

權威 Rust contract 至少包含：

```rust
pub struct EmptyRequest {}

pub struct BuildInfoDto {
    pub version: String,
    pub git_sha: String,
    pub build_profile: String,
}

pub trait CommandContract {
    const NAME: &'static str;
    type Request;
    type Response;
}
```

`get_build_info(EmptyRequest) -> BuildInfoDto` 必須從相同 Rust DTO 生成 TypeScript。生成檔禁止手改。

## 實作約束

- `core` 禁止 filesystem、network、clock、SQLite、Tauri。
- 生成輸出必須 deterministic；相同 checkout 連跑兩次 byte-identical。
- CI 中 contract check 必須以重新生成後 `git diff --exit-code` 類型機制阻斷 drift。
- `npm ci` 為權威安裝命令；lockfile 必須提交。
- Production build 不得依賴本機絕對路徑或未提交檔案。
- 不在本節點引入業務資料表、Markdown renderer 或 workspace 功能。

## BDD 場景

### 場景 1：全新 checkout

**Given** 一個乾淨 checkout  
**When** 執行 `make bootstrap && make ci`  
**Then** Rust/TS 測試、lint、contract check、frontend build 全綠，並可啟動空視窗。

### 場景 2：Contract drift

**Given** 修改 Rust DTO 或 command 名稱但未更新生成物  
**When** 執行 `make check-contracts`  
**Then** 命令失敗並列出具體差異檔。

### 場景 3：Core 邊界

**Given** 在 `core` 新增 `rusqlite` 或 `tauri` 依賴  
**When** 執行 `make ci`  
**Then** dependency boundary check 阻斷。

## 測試計畫

- `core` placeholder 純函數 unit test。
- `get_build_info` Rust serialization golden test。
- Generated TypeScript snapshot。
- Contract generator determinism test。
- CI negative test script：刻意製造 drift，確認非零 exit。
- Dependency allow-list/deny-list test。

## 驗收標準

- 三個 BDD 場景皆可在乾淨環境重現。
- `make ci` 為單一完整 gate。
- 空應用冷啟動可觀測且不產生未處理錯誤。
- `contracts/locks/N00.json` 已凍結。
- README 不依賴口頭知識。

## 性能與觀測

- 空應用 release build 冷啟動到可互動 `< 1.5 s`，記錄基準硬體。
- CI 每個階段輸出可辨識名稱與耗時。
- build info 與 command correlation ID 可在本地日誌確認。

## 非範圍

- SQLite schema。
- Workspace、render、annotation 等產品功能。
- 打包簽名、公證與多平台 release pipeline。

## 建議衍生任務

1. `T01-scaffold-rust-workspace`
2. `T02-scaffold-react-tauri`
3. `T03-contract-trait-and-generator`
4. `T04-generated-ts-wrapper`
5. `T05-core-boundary-check`
6. `T06-make-and-ci`
7. `T07-bootstrap-verification`

## Legacy 移植規則

可參考 legacy 的目錄與 CI，但禁止整包複製。先建立本節點測試與 contract，再逐檔移植有用配置；舊 command surface 不得帶入。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N00.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N01-sqlite-schema-migrations.md`

---
id: N01
title: SQLite Schema、Migration 與 Repository
kind: core
milestone: M0
status: todo
depends_on: 
  - N00
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread SQLite schema and migration patterns
allowed_paths: 
  - crates/db/**
  - crates/core/src/contracts/N01*
  - src-tauri/src/db*
  - contracts/locks/N01.json
  - docs/tasks/N01/**
  - docs/verification/N01.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N01 — SQLite Schema、Migration 與 Repository

## 目標

實作 `SPEC.md` §9 的完整 SQLite 基線、migration framework、資料不變量、transaction policy 與 typed repository，使所有上層節點不需直接接觸 SQL。

## 輸入與前置條件

- N00 已完成，contract/CI 可用。
- `SPEC.md` §3、§6、§9。
- DB path 由 Tauri platform app-data directory 提供。

## 範圍與交付物

- 建立 migration runner、`schema_migrations(version, checksum, applied_at)`。
- 實作 `SPEC.md` §9.2 全部資料表、index 與 §9.3 triggers。
- 每個 connection 設定 foreign keys、WAL、synchronous、busy timeout。
- 使用 UUIDv7 字串 ID、UTC epoch milliseconds。
- 建立 blocking DB executor：單一 write actor、有界 read connections；測試可注入 fixed clock/ID。
- 建立 typed repository 與 transaction boundary；禁止上層寫 raw SQL。
- 建立 soft-delete API primitive。
- 建立測試 DB factory：in-memory 與 tempfile WAL 兩種。
- 建立 seed/benchmark helper，產生 10,000 annotation 與 10,000 bindings。

## Contract

本節點不新增使用者可見 Tauri command，但需凍結 repository-facing domain types：

```rust
pub struct RowVersion(pub u64);
pub struct DocumentId(pub Uuid);
pub struct AnnotationId(pub Uuid);
pub struct TagId(pub Uuid);

pub trait TransactionRunner {
    fn transaction<T>(&self, f: impl FnOnce(&mut Transaction) -> Result<T>) -> Result<T>;
}
```

Repository interface 只暴露 typed method；SQL row 不得跨出 `db` crate。

## 實作約束

- DDL 語義必須與 `SPEC.md` §9 一致。
- `documents`、`annotations`、`comments` hard delete 必須由 trigger 阻斷。
- Comment parent trigger 必須同時驗證同 annotation 與最多一層。
- System tag trigger 必須保護 `pin`。
- Migration 不提供 down，不允許跳號、重複 version 或 checksum 變更。
- Application migration 執行失敗時不得啟動到主 UI。
- Mutation 必須在 transaction 內更新該 table 的 `updated_at`。只有具
  `row_version` 的 annotation/comment mutation 遞增該 token；document
  version commit 遞增 `revision`；app-state compare-and-set 使用
  `expected_updated_at`。Create、idempotent desired-set 與 tag merge 不新增
  schema 未定義的 row version。
- 禁止在 Tauri async runtime thread 直接執行 rusqlite blocking query。

## BDD 場景

### 場景 1：空庫升級

**Given** 空 DB  
**When** migration runner 執行  
**Then** 升到 latest version，checksum 與 applied_at 完整。

### 場景 2：冪等啟動

**Given** 已是 latest schema  
**When** migration runner 再次執行  
**Then** 無 DDL 重跑、無資料變更、結果成功。

### 場景 3：禁止 hard delete

**Given** document 下存在 annotation/comment  
**When** 任意 raw `DELETE` 嘗試刪除 document、annotation 或 comment  
**Then** SQLite trigger 拒絕，原資料完整。

### 場景 4：一層引用

**Given** comment B 回覆 comment A  
**When** 嘗試建立 comment C 回覆 B  
**Then** transaction 失敗並回傳 validation error。

## 測試計畫

- `db/tests/migrations.rs`：空庫、逐版升級、latest 重跑、checksum tamper。
- `db/tests/invariants.rs`：hard delete、annotation kind/anchor check、document model version、system pin、comment parent。
- `db/tests/soft_delete.rs`：annotation tombstone 同步 comments；comment tombstone 保留 replies。
- `db/tests/concurrency.rs`：row_version conflict。
- WAL tempfile integration test。
- 10,000 row migration/seed benchmark。

## 驗收標準

- 所有 DDL、trigger、index 有自動測試。
- SQLite foreign key violations 無法由 repository 繞過。
- 10,000 annotation 的初始 migration/seed 操作 `< 1 s`（release build，記錄硬體）。
- DB 檔案位於 platform app-data directory。
- 上層 crate 無 raw SQL。

## 性能與觀測

- migration、transaction、busy retry 皆輸出結構化 duration。
- DB error 日誌不得包含 annotation/comment body。
- 建立 index query plan snapshot，避免後續 schema 漂移。

## 非範圍

- Workspace command。
- Anchor 演算法。
- Tag UI。
- 永久 purge、down migration、雲端備份。

## 建議衍生任務

1. `T01-migration-runner`
2. `T02-base-schema`
3. `T03-integrity-triggers`
4. `T04-repository-interfaces`
5. `T05-soft-delete-semantics`
6. `T06-db-executor-concurrency-and-row-version`
7. `T07-schema-benchmarks`

## Legacy 移植規則

可閱讀 legacy schema 取得命名與 query 經驗，但 DDL 必須按新 schema 重寫；不得帶入 polymorphic tag binding、hard delete cascade 或舊 annotation state。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N01.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N02-workspace-lazy-tree.md`

---
id: N02
title: Workspace、PathGuard 與 Lazy File Tree
kind: core
milestone: M1
status: todo
depends_on: 
  - N00
  - N01
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread workspace, mtime cache, large-directory guard
allowed_paths: 
  - src-tauri/src/workspace/**
  - src-tauri/src/path_guard/**
  - crates/core/src/contracts/N02*
  - src/features/workspace/**
  - contracts/locks/N02.json
  - docs/tasks/N02/**
  - docs/verification/N02.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N02 — Workspace、PathGuard 與 Lazy File Tree

## 目標

讓使用者安全加入本地根目錄，按需展開文件樹並開啟 Markdown；所有檔案存取由同一 PathGuard 保證 workspace 唯讀與不可逃逸。

## 輸入與前置條件

- N00 contract pipeline。
- `SPEC.md` §3、§7、§8、§11.1。
- M0 gate 已確認 N01 schema/repository 可用；不得以 mock 合併本節點。

## 範圍與交付物

- Workspace CRUD 的 v1 最小集合：list/create；不做永久 delete。
- 透過系統目錄選擇器加入 root；canonicalize 後保存。
- root detach：停止 watch/瀏覽但保留 document metadata。
- 拒絕同一 workspace 內 canonical path 相同或祖先/子孫重疊的 active roots。
- `PathGuard`：component validation、canonical containment、symlink reject、read-only open。
- `list_directory` 真 lazy、cursor pagination、extension filter、gitignore 規則；對 Markdown entry upsert identity 並回穩定 document UUID，但不讀正文。
- 目錄 entry 類型：directory、markdown_file、other_file、symlink。
- `open_document`：以 stable read（前後 metadata/file identity 檢查，最多重試 2 次）驗證 UTF-8、20 MiB limit，回傳 observed source hash 與 committed revision；只 upsert identity/mtime/size/last_seen，不推進 revision、不覆寫 committed hash。
- `resolve_local_document_link`：只解析 exact relative/root Markdown path，不做 basename 猜測；合法 `../` 經 source-relative 正規化後仍須位於同 root，回傳 document ID 與 fragment。
- `read_workspace_asset`：PathGuard 內讀取 PNG/JPEG/GIF/WebP，10 MiB limit；remote/data/SVG 拒絕。
- `list_recent_documents`。
- file tree UI：展開時才呼叫下一層；truncated/load-more 狀態。

## Contract

新增 command：

```text
list_workspaces({})
create_workspace({ name })
add_workspace_root({ workspace_id, selected_path, ext_filter?, ignore_rules? })
detach_workspace_root({ root_id })
list_directory({ root_id, rel_dir, cursor?, limit? })
open_document({ document_id })
resolve_local_document_link({ source_document_id, href })
read_workspace_asset({ source_document_id, href })
list_recent_documents({ workspace_id, cursor?, limit? })
```

`DirectoryPage` 必須含 `entries`, `next_cursor`, `truncated`。`OpenDocumentResponse` 必須含 document metadata、UTF-8 source、`observed_source_hash`、`committed_source_hash`、`committed_canonical_hash`、`committed_model_version`、revision。

## 實作約束

- Frontend 不得直接取得任意 filesystem capability。
- 禁止 string prefix sandbox。
- v1 不跟隨任何 symlink；顯示但不可展開/開啟。
- 圖片 command 只以 binary response/stream 回 MIME whitelist bytes；使用 magic bytes 驗證，不回任意 file URL。
- 直接 command `rel_path` 禁止 absolute、`..`、NUL、空 component；Markdown href 可含 `..`，但必須 URL-decode 一次、正規化後仍在 source root 內。
- 目錄列舉 deterministic：directory 先、file 後；同類按 Unicode display name 穩定排序。
- `.mdx` 不執行 JSX。
- root 內任何操作只讀。
- 大目錄不得一次讀取/渲染全部 entry。

## BDD 場景

### 場景 1：大型 workspace

**Given** root 下總計 5000 文件  
**When** 首次載入 file tree  
**Then** 只讀根層，`< 500 ms` 可互動，未展開子目錄不產生 IO。

### 場景 2：Traversal

**Given** `../x.md`、absolute path、NUL、encoded traversal 等請求  
**When** 任意 filesystem command 收到  
**Then** 回 `PATH_OUTSIDE_WORKSPACE` 或 validation error，不讀取目標。

### 場景 3：Symlink escape

**Given** root 內 symlink 指向 root 外  
**When** 使用者展開或開啟  
**Then** 顯示不可用並回 `SYMLINK_FORBIDDEN`。

### 場景 4：Root overlap

**Given** workspace 已有 `/kb` root  
**When** 嘗試加入 `/kb/subdir` 或同一 directory 的另一種 path 表示  
**Then** 拒絕並說明 active roots 不得重疊。

### 場景 5：Local asset

**Given** Markdown 引用 root 內 PNG 與 root 外/remote/SVG 圖片  
**When** reader 請求 asset  
**Then** 只有 root 內 whitelist 圖片可讀，其餘安全拒絕且不發網路請求。

### 場景 6：Ignore

**Given** ignore rules 含 `drafts/**`  
**When** 列出 tree 或 palette index  
**Then** drafts 不出現且不可由相對路徑繞過開啟。

## 測試計畫

- `core` 路徑 component validation table test。
- `src-tauri` tempfile integration：`../`、absolute、Unicode、symlink、race replacement。
- Gitignore semantics fixture。
- Root overlap/case-sensitivity platform tests。
- Directory pagination/cursor determinism。
- 5000 files benchmark。
- React component：未展開不 fetch、展開 fetch 一次、load more。
- `open_document`：UTF-8、non-UTF8、20 MiB limit、hash、讀取期間變更重試。
- Local link/asset：合法 parent-relative、escape traversal、double-encoding、remote、data URI、SVG、MIME spoof、10 MiB limit。

## 驗收標準

- 六個 BDD 場景全過。
- 所有 filesystem command 共用同一 PathGuard，不得複製判斷。
- 5000 文件首屏 `< 500 ms`。
- 未開啟文件不讀正文。
- root detach 後 annotation/document metadata 不刪除。

## 性能與觀測

- directory command 記錄 entry count、duration、truncated，不記完整絕對路徑。
- 讀檔記錄 bytes、duration、hash prefix。
- UI 可觀測 pending/error/retry。

## 非範圍

- 全文索引。
- 追蹤 symlink。
- 永久刪除 workspace/root。
- Watcher（A02）。

## 建議衍生任務

1. `T01-workspace-contracts`
2. `T02-path-guard`
3. `T03-root-lifecycle`
4. `T04-directory-pagination`
5. `T05-document-open-and-stable-read`
6. `T06-local-link-and-asset-commands`
7. `T07-tree-ui`
8. `T08-security-and-performance-verification`

## Legacy 移植規則

可移植 legacy 的 ignore、mtime cache、大目錄 UX；lazy loading、cursor、PathGuard 必須按本規格重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N02.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N03-markdown-render-model.md`

---
id: N03
title: Deterministic Markdown Render Model
kind: core
milestone: M1
status: todo
depends_on: 
  - N00
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread GFM/TOC/highlight reader UI
allowed_paths: 
  - src/lib/document-model/**
  - src/features/reader/**
  - fixtures/markdown/**
  - docs/tasks/N03/**
  - docs/verification/N03.md
  - contracts/locks/N03.json
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N03 — Deterministic Markdown Render Model

## 目標

建立唯一、確定性的 Markdown render pipeline，一次產生 sanitized HTML、canonical text、TOC 與 source map，作為閱讀、選區、搜尋與重錨的共同語義基線。

## 輸入與前置條件

- N00 frontend/test pipeline。
- `SPEC.md` §4.2、§5、§11。
- 不依賴 N02；以 fixture source 開發。

## 範圍與交付物

- 實作純 TypeScript `buildDocumentModel(source)`。
- 支援 GFM：table、task list、strikethrough、autolink。Footnote 不列入 v1 gate。
- heading ID deterministic，重複 heading 以出現序穩定 suffix。
- TOC 由同一 AST 產生。
- code syntax highlight 使用本地 bundle；缺少 language 時安全降級。
- YAML/TOML front matter 識別後排除於 body/canonical text；不自動匯入 tag。
- raw HTML sanitize。
- 產生 canonical text 與 `TextSegment[]`。
- 將 segment metadata 放入 HTML，可由 DOM selection 反查。
- 產生 best-effort source byte/line map。
- 將標準 link/image 轉成受控 React adapter metadata；禁止 webview 直接載入 relative/remote asset。
- 建立 pipeline schema version = 1 與 canonicalization regression fixtures。

## Contract

本節點主要 contract 為 TypeScript 純型別，欄位必須與 `SPEC.md` §5.2 完全一致：

```ts
buildDocumentModel(source: string): DocumentModel
```

若新增 Rust DTO，只能用於 `DocumentModelSummary` 或 hash 驗證，不得在 Rust 再實作第二套 Markdown parser。

## 實作約束

- 同一 input 重跑必須 byte-identical。
- segment ID 禁止 random。
- canonicalization 規則只能由本模組實作。
- source map 可 best-effort，但 canonical range 不得依賴 source map。
- render time 不得因 source map 超過無 map baseline 的 2 倍。
- 禁止 remote syntax/theme/asset。
- `#heading`、local Markdown link、external URL、local image 必須走 `SPEC.md` §11.2 的受控行為。
- 私人 KB 不得提交；fixture 必須 synthetic/去識別。
- Pipeline 行為變動需 ADR，不得由 downstream node 任意改。

## BDD 場景

### 場景 1：確定性

**Given** 同一 Markdown fixture  
**When** 連續 build 100 次  
**Then** HTML、canonical text、hash、segments、TOC byte-identical。

### 場景 2：大型文件

**Given** 1 MiB、含 table/list/code/CJK 的 Markdown  
**When** build document model  
**Then** `< 300 ms`，TOC 與 segment range 有效。

### 場景 3：Raw HTML

**Given** source 含 script、event handler、dangerous URL  
**When** render  
**Then** 危險內容被移除，其餘文件正常呈現。

### 場景 4：Code whitespace

**Given** code block 含縮排與多空白  
**When** canonicalize  
**Then** code whitespace 保留；prose 空白按 §5.3 折疊。

## 測試計畫

- Canonicalization table test：CRLF、NBSP、soft/hard break、NFC、code block。
- Snapshot fixtures：CJK、emoji、combining marks、table、list、duplicate headings、raw HTML、MDX。
- Segment invariant：
  - ranges 單調、無越界。
  - canonical slice 與 DOM leaf text對應。
  - source range 若存在則有效。
- Determinism property。
- 1 MiB performance benchmark。
- sanitize security corpus。
- Link/image protocol tests：heading、relative Markdown、http/mailto、file/javascript、remote image、local image placeholder。

## 驗收標準

- 四個 BDD 場景全過。
- 3–5 個 synthetic representative fixture snapshot 入庫。
- `DocumentModel.schemaVersion=1`。
- Pipeline 產物足以支援 N05，不需重新解析 source。
- Reader 可呈現核心 GFM 並安全降級。

## 性能與觀測

- 記錄 parse/render/canonicalize/source-map 各階段 duration。
- 1 MiB `< 300 ms`。
- HTML 與 model size 記錄但不得記正文。

## 非範圍

- Annotation highlighter。
- Mermaid 圖形轉換（A06）。
- Wikilink resolution（A05）。
- Markdown 編輯或 source write-back。

## 建議衍生任務

1. `T01-document-model-types`
2. `T02-markdown-ast-pipeline`
3. `T03-canonicalizer`
4. `T04-segment-and-source-map`
5. `T05-sanitize-highlight-link-image-adapters`
6. `T06-reader-renderer`
7. `T07-fixtures-determinism-benchmark`

## Legacy 移植規則

可移植 legacy 的排版、TOC 與高亮樣式；render model、canonicalizer、segment/source map 必須按本節點新寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N03.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N04-tabs-state.md`

---
id: N04
title: 多分頁與狀態持久化
kind: core
milestone: M1
status: todo
depends_on: 
  - N02
  - N03
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread open_tabs persistence
allowed_paths: 
  - src/features/tabs/**
  - src-tauri/src/commands/app_state*
  - crates/core/src/contracts/N04*
  - contracts/locks/N04.json
  - docs/tasks/N04/**
  - docs/verification/N04.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N04 — 多分頁與狀態持久化

## 目標

提供多文件 tab、每 tab 獨立捲動位置與重啟恢復；恢復過程必須 lazy，missing 文件不得造成崩潰。

## 輸入與前置條件

- N02 可安全開啟 document。
- N03 可 render document model。
- N01 app_state schema 可用。

## 範圍與交付物

- Tab state machine：open、activate、close、close others。
- Tab identity 使用 document UUID。
- 每 tab 保存 scroll offset、last active time。
- 持久化 active workspace、open tabs、active tab。
- save debounce，app close 前 flush。
- 啟動時只立即載入 active tab，其餘 tab lazy restore。
- missing document tab 顯示占位與 known path。

## Contract

新增：

```text
load_app_state({ scope, keys })
save_app_state({ scope, entries, expected_updated_at? })
```

State JSON 必須帶 schema version；未知較新版本不得崩潰，回明確錯誤並保留 DB 原值。

## 實作約束

- localStorage 不得作權威來源。
- 任何 tab action 必須由純 reducer 測試。
- scroll restore 必須在 document model 完成後執行，且 clamp 到有效範圍。
- 啟動恢復不得同時讀取所有 tab 正文。
- State write 失敗顯示非阻斷提示，不得丟失當前 UI state。

## BDD 場景

### 場景 1：重啟恢復

**Given** 3 個 tab，各自位於不同 scroll offset  
**When** 關閉並重啟  
**Then** tab、active tab、各自 scroll 恢復。

### 場景 2：Missing 文件

**Given** 某 tab 對應文件外部刪除  
**When** 重啟  
**Then** tab 保留並顯示 missing 占位，不崩潰。

### 場景 3：Lazy restore

**Given** 保存 10 個 tab  
**When** 啟動  
**Then** active tab 先可讀，其餘只在 activation 或 idle preload 時讀取。

## 測試計畫

- Pure reducer table test。
- app_state serialization/version test。
- React component：close/activate/close others。
- scroll restore with delayed render。
- missing document integration。
- 10 tabs load trace，確認無 burst open。

## 驗收標準

- 三個 BDD 場景全過。
- 10 tab 切換無可感知卡頓。
- app close 前 state flush 可重現。
- state schema 有版本與 backward-compatible reader。

## 性能與觀測

- Tab action UI budget `< 16 ms`（不含文件載入）。
- State write debounce 建議 250 ms。
- 日誌只記 tab count/document ID，不記正文。

## 非範圍

- Tab reorder、跨視窗 tab。
- 雲端同步。
- 任意 layout/workspace restore。

## 建議衍生任務

1. `T01-tab-state-machine`
2. `T02-app-state-contract`
3. `T03-persistence-adapter`
4. `T04-lazy-restore`
5. `T05-scroll-restoration`
6. `T06-integration-verification`

## Legacy 移植規則

可參考 legacy open_tabs 資料形態，但須改用 document UUID、schema version 與 lazy restore。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N04.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N05-selection-anchor-capture.md`

---
id: N05
title: DOM Selection 到 Anchor Capture
kind: core
milestone: M2
status: todo
depends_on: 
  - N03
size: L
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread TextQuoteSelector capture
allowed_paths: 
  - src/features/annotations/selection/**
  - crates/core/src/anchor/capture.rs
  - crates/core/src/contracts/N05*
  - src-tauri/src/commands/anchor*
  - contracts/locks/N05.json
  - docs/tasks/N05/**
  - docs/verification/N05.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N05 — DOM Selection 到 Anchor Capture

## 目標

把瀏覽器 DOM Range 可靠映射為 canonical UTF-8 byte range，並由 Rust core 建立 AnchorV1；CJK、emoji、跨 block 與 code selection 必須正確。

## 輸入與前置條件

- N03 的 `DocumentModel`、segment metadata 與 deterministic DOM。
- `SPEC.md` §5、§6.1。
- N00 contract generation。

## 範圍與交付物

- Selection listener 只接受 reader root 內的 selection。
- DOM text-node local offset（UTF-16）轉 Unicode scalar，再轉 canonical UTF-8 byte offset。
- 支援跨 paragraph/list/code block selection。
- 移除 selection 邊界中由 UI 插入、但不屬 canonical text 的節點。
- collapsed 或 canonical exact 全空白時不顯示「建立批注」。
- 浮動建立入口，鍵盤可操作。
- `build_anchor` command 呼叫 `core::anchor::capture`。
- Anchor prefix/suffix 各最多 32 Unicode scalar。
- source span 由 intersected segments 合併為 best-effort hint。

## Contract

新增：

```text
build_anchor({
  canonical_text,
  start_byte,
  end_byte,
  source_hash,
  canonical_hash,
  document_model_version,
  source_span_hint?
}) -> AnchorV1
```

Command 必須重算 canonical text SHA-256，並驗證 byte boundary、range、hash 格式、model version 與 exact 非空。若 frontend model hash 與 command input 不一致，回 `RENDER_MODEL_MISMATCH`；未知 model version 回 `UNSUPPORTED_MODEL_VERSION`。

## 實作約束

- DOM 不得成為持久 anchor。
- Offset unit 一律 UTF-8 byte；禁止混用 JS UTF-16 index。
- Anchor capture core 為純函數。
- Prefix/suffix 不保證唯一；建立 anchor 不得假裝唯一，歧義由 N09 保守處理。
- 任何 highlight/search UI wrapper 不得改變 canonical mapping。
- Selection 跨越 reader 外部或兩個文件時拒絕。
- Source span 錯誤不得影響 exact/prefix/suffix。

## BDD 場景

### 場景 1：跨 block

**Given** selection 從段落 A 跨到列表 B  
**When** 建立 anchor  
**Then** exact 等於 canonical text 對應聯合區間，range 為有效 UTF-8 boundary。

### 場景 2：CJK 與 emoji

**Given** selection 包含中文、emoji surrogate pair、combining mark  
**When** 轉換 offset  
**Then** exact 與視覺選區一致，無 byte slicing panic 或錯一字符。

### 場景 3：重複文字

**Given** exact 在文件出現三次  
**When** 建立 anchor  
**Then** anchor 保存 context 與 position hint；不宣稱已唯一識別。

### 場景 4：無效 selection

**Given** collapsed、全空白或跨 reader root selection  
**When** selectionchange  
**Then** 不顯示入口且不呼叫 command。

## 測試計畫

- Rust capture table test至少 20 cases：文首/尾、短 exact、CJK、emoji、combining、code、重複。
- TS DOM Range mapping test：nested inline elements、links、code span、跨 block。
- UTF-16 → UTF-8 conversion property test。
- Model segment boundary fuzz test。
- Keyboard/accessibility component test。
- 10 次本機 CJK 手動抽測記錄。

## 驗收標準

- 四個 BDD 場景全過。
- 至少 20 個 table case 全綠。
- 無任何 offset unit 未標注的公開型別。
- `AnchorV1` JSON 與 `SPEC.md` 完全一致，含 `document_model_version=1`。
- N06 可直接消費 anchor，無需再讀 source/DOM。

## 性能與觀測

- Selection mapping 在一般文件 `< 16 ms`。
- `build_anchor` 純函數 `< 2 ms`（1 MiB text、單 range）。
- 日誌只記 range 長度與 hash，不記 exact。

## 非範圍

- 保存 annotation（N06）。
- Reanchor（N09）。
- Source editor 跳轉。

## 建議衍生任務

1. `T01-selection-boundary-contract`
2. `T02-dom-segment-mapper`
3. `T03-utf16-to-utf8-offset`
4. `T04-rust-anchor-capture`
5. `T05-floating-action-ui`
6. `T06-edge-case-property-tests`
7. `T07-manual-cjk-verification`

## Legacy 移植規則

Legacy selector 可作測試資料來源，不直接複製 offset/DOM 實作；新 mapping 以 N03 segment model 為唯一基礎。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N05.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N06-annotation-crud-highlight.md`

---
id: N06
title: Annotation CRUD、Sidebar 與重疊高亮
kind: core
milestone: M2
status: todo
depends_on: 
  - N01
  - N04
  - N05
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread annotation CRUD, sidebar, highlight
allowed_paths: 
  - crates/db/src/repositories/annotations*
  - crates/core/src/contracts/N06*
  - src-tauri/src/commands/annotations*
  - src/features/annotations/**
  - contracts/locks/N06.json
  - docs/tasks/N06/**
  - docs/verification/N06.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N06 — Annotation CRUD、Sidebar 與重疊高亮

## 目標

完成 range annotation 與 document note 的建立、讀取、更新、軟刪除、sidebar 呈現與可重疊高亮，形成第一條完整 dogfood 旅程。

## 輸入與前置條件

- N01 schema/repository。
- N05 AnchorV1。
- N03 DocumentModel segment。
- N04 tabs 可用於 E2E。

## 範圍與交付物

- Commands：list/create/update/delete annotation。
- Range annotation 可 body 空白；document note body 必須非空。
- color 限定五色 enum。
- mutation 使用 row_version。
- delete 為 tombstone，並在同 transaction tombstone comments。
- Sidebar：document note 頂部、range 依位置、orphan 分區。
- 高亮：interval segmentation 支援 overlap；leaf span 帶多 annotation IDs。
- 點 sidebar item 捲動到 range；點 highlight 選中 sidebar item。
- 100 annotation 文件的 render/update。
- E2E：選字 → 建批注 → 重開 → 仍可見。

## Contract

新增：

```text
list_annotations({ document_id, include_deleted?: false })
create_annotation({
  document_id, kind, body, color, anchor?,
  snapshot?: DocumentSnapshotRef
})
update_annotation({
  annotation_id, expected_row_version, body?, color?
})
delete_annotation({
  annotation_id, expected_row_version
})
```

Response 必須含 `row_version`, `anchor_status`, `last_resolution`, timestamps。

## 實作約束

- Annotation 不 hard delete。
- `kind=document` 時 anchor 必須 null；`kind=range` 時 anchor 與 snapshot 必須存在。
- UI 不得從 DOM 推測排序；以 current anchor start hint/重錨結果為基礎。
- 重疊 range 不得產生非法交錯 DOM。
- Search highlight 未完成前，renderer API 仍須支援多 layer interval。
- Mutation conflict 不得覆蓋別的更新。
- Range create 必須由 adapter 驗證 current stable file hash，並由 DB 驗證 snapshot revision/source/canonical/model version；stale model 不得建立。
- 刪除後 UI 即時隱藏，但資料保留。

## BDD 場景

### 場景 1：Range annotation

**Given** 使用者選中文字建立批注  
**When** 關閉再開該文件  
**Then** 高亮與 sidebar body/顏色一致。

### 場景 2：Document note

**Given** 無 selection，建立文件級筆記  
**When** 顯示 sidebar  
**Then** 位於頂部分區且正文沒有高亮。

### 場景 3：重疊

**Given** annotation A 與 B range 部分重疊  
**When** render  
**Then** 兩者都可點選，DOM mapping 仍可供新 selection 使用。

### 場景 4：Stale snapshot

**Given** 使用者選字後文件在外部被修改  
**When** 以舊 snapshot 建立 range annotation  
**Then** 回 CONFLICT，DB 無 annotation，UI refresh 後要求重新選取。

### 場景 5：軟刪除

**Given** annotation 有 comments  
**When** 使用者刪除 annotation  
**Then** UI 隱藏 annotation/comments，DB 只設 tombstone，不 hard delete。

## 測試計畫

- Repository CRUD/row_version/soft-delete tests。
- Range snapshot/file-hash conflict integration test。
- Contract serialization tests。
- Interval segmentation table/property test：disjoint、nested、crossing、same boundary。
- Sidebar ordering/component tests。
- Highlight → sidebar 和 sidebar → scroll integration。
- E2E #1。
- 100 annotation render benchmark。

## 驗收標準

- 五個 BDD 全過。
- E2E #1 綠。
- 100 annotations 無明顯卡頓。
- DB 查詢不回已刪資料（除非 include_deleted）。
- Overlap 不破壞 N05 selection mapping。

## 性能與觀測

- 100 annotation interval segmentation `< 20 ms`。
- list query 有 index plan。
- 日誌不記 body/exact，只記 count、duration、IDs。

## 非範圍

- Comment thread（N07）。
- Automatic reanchor（N09）。
- Tag（N08）。
- Rich text annotation body。

## 建議衍生任務

1. `T01-annotation-contracts`
2. `T02-repository-crud`
3. `T03-soft-delete-and-conflict`
4. `T04-interval-segmentation`
5. `T05-highlight-renderer`
6. `T06-sidebar-and-navigation`
7. `T07-e2e-and-benchmark`

## Legacy 移植規則

可按新測試移植 legacy CRUD/樣式；hard delete、單一高亮巢狀策略與舊 state 不得移植。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N06.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N07-comment-thread.md`

---
id: N07
title: Comment Thread 與 Tombstone 引用
kind: core
milestone: M2
status: todo
depends_on: 
  - N06
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread annotation reply thread
allowed_paths: 
  - crates/db/src/repositories/comments*
  - crates/core/src/contracts/N07*
  - src-tauri/src/commands/comments*
  - src/features/comments/**
  - contracts/locks/N07.json
  - docs/tasks/N07/**
  - docs/verification/N07.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N07 — Comment Thread 與 Tombstone 引用

## 目標

在 annotation 下提供最多一層引用的留言串，使用 row-version concurrency 與 tombstone 保留引用結構。

## 輸入與前置條件

- N06 annotation lifecycle。
- N01 comment table/trigger。
- `SPEC.md` §9.4、§11.4。

## 範圍與交付物

- list/create/update/delete comment。
- parent_id 可 null 或指向同 annotation 的 root comment。
- UI 展開/折疊。
- Deleted comment 顯示 tombstone，回覆保留。
- Update/delete 使用 row_version。
- Annotation soft delete 時 comments 同步 tombstone。

## Contract

新增：

```text
list_comments({ annotation_id, include_deleted?: true })
create_comment({ annotation_id, parent_id?, body })
update_comment({ comment_id, expected_row_version, body })
delete_comment({ comment_id, expected_row_version })
```

預設 list 必須包含 tombstone metadata，以便保留 thread。

## 實作約束

- 最多一層；DB trigger 與 application validation 雙重保證。
- parent 必須同 annotation。
- body trim 後不可空。
- delete 不清空 child 的 parent_id。
- UI 不得顯示 tombstone 原 body。
- thread deterministic sort：created_at、ID tie-break。

## BDD 場景

### 場景 1：一層回覆

**Given** A、B、C 三條留言，C 回覆 A  
**When** 展開 thread  
**Then** 引用關係清楚且順序穩定。

### 場景 2：Parent 刪除

**Given** C 回覆 A  
**When** 刪除 A  
**Then** A 顯示「原留言已刪除」，C 仍存在。

### 場景 3：禁止二層

**Given** C 已回覆 A  
**When** 嘗試讓 D 回覆 C  
**Then** 回 validation error，DB 無部分寫入。

## 測試計畫

- DB parent trigger tests。
- Repository CRUD/row_version/tombstone。
- Contract serialization。
- Thread projection pure function。
- React component：expand、reply、edit、delete、tombstone。
- Annotation delete cascade-to-tombstone integration。

## 驗收標準

- 三個 BDD 場景全過。
- 無 hard delete。
- Conflict 不覆蓋留言。
- Thread UI 鍵盤可操作。

## 性能與觀測

- 100 comments list/render 無可感知延遲。
- 日誌不記 body。

## 非範圍

- 無限巢狀。
- Mention、reaction、多人身份、同步。

## 建議衍生任務

1. `T01-comment-contracts`
2. `T02-repository-and-trigger`
3. `T03-thread-projection`
4. `T04-comment-ui`
5. `T05-tombstone-and-conflict-tests`

## Legacy 移植規則

Legacy reply UI 可參考；持久化必須改成 tombstone 與一層 DB constraint。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N07.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N08-tag-system.md`

---
id: N08
title: 扁平 Tag 系統與 System Pin
kind: core
milestone: M4
status: todo
depends_on: 
  - N01
  - N04
  - N06
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: []
allowed_paths: 
  - crates/core/src/tags/**
  - crates/db/src/repositories/tags*
  - crates/core/src/contracts/N08*
  - src-tauri/src/commands/tags*
  - src/features/tags/**
  - contracts/locks/N08.json
  - docs/tasks/N08/**
  - docs/verification/N08.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N08 — 扁平 Tag 系統與 System Pin

## 目標

建立文件與 annotation 的全局扁平標籤系統，具 Unicode normalization、rename/merge transaction、autocomplete 與不可變 system tag `pin`。

## 輸入與前置條件

- N01 tags/document_tags/annotation_tags schema。
- N04 document header/tab UI 掛點。
- N06 annotation sidebar 掛點。
- `SPEC.md` §9.5、§11.5。

## 範圍與交付物

- Tag normalization：trim → NFKC → Unicode case fold → trim。
- create/list/rename/merge/delete user tag。
- set document tags、set annotation tags，輸入完整 desired set，操作冪等。
- Autocomplete 顯示 display_name，按 normalized key 搜尋。
- document tree/context/header 與 annotation sidebar 的 tag picker。
- System tag `pin` seed migration；不可 rename/delete，只可綁 document。
- Merge 在單一 transaction 更新兩種 binding 並去重。
- 10,000 binding query/index benchmark。
- 作為 G2 無 legacy 節點的獨立覆盤樣本。

## Contract

新增：

```text
list_tags({ query?, cursor?, limit? })
create_tag({ display_name })
rename_tag({ tag_id, display_name })
merge_tags({ source_tag_id, target_tag_id })
delete_tag({ tag_id })
set_document_tags({ document_id, tag_ids })
set_annotation_tags({ annotation_id, tag_ids })
```

所有 response 回傳 canonical tag DTO：id、display_name、normalized_name、kind。

## 實作約束

- 不使用 SQLite `COLLATE NOCASE` 作 Unicode 唯一性。
- 不使用 polymorphic target_id table。
- `/` 不具 hierarchy。
- rename/merge 必須 transaction。
- 重複 binding 冪等。
- system pin 只能 document。
- Deleted annotation 不應出現在一般 tag result；binding 可保留供 backup。
- Tag max 64 Unicode scalar；空或 normalization 後空字串拒絕。

## BDD 場景

### 場景 1：Normalization

**Given** `Terraform`、` terraform ` 與大小寫等價輸入  
**When** create  
**Then** 只存在一個 normalized tag，UI 回現有 tag。

### 場景 2：Merge

**Given** `tf` 與 `terraform` 分別綁定多個 document/annotation  
**When** merge `tf` → `terraform`  
**Then** 全部 binding 移轉、重複去除、source tag 刪除，transaction 不留中間態。

### 場景 3：Pin

**Given** system tag `pin`  
**When** 嘗試 rename/delete 或綁 annotation  
**Then** transaction 被拒絕。

### 場景 4：冪等 set

**Given** target 已有指定 tags  
**When** 重送相同 desired set  
**Then** DB 無重複 row，結果相同。

## 測試計畫

- Unicode normalization table/property test。
- DB create/rename/merge/delete transaction tests。
- System pin trigger tests。
- set desired state idempotency。
- 10,000 bindings benchmark。
- Autocomplete component。
- Document/annotation tag picker integration。

## 驗收標準

- 四個 BDD 全過。
- 10,000 bindings 基礎查詢 `< 50 ms`。
- 無 polymorphic FK。
- Merge 可在失敗注入時完整 rollback。
- 完成單獨 G2 verification report。

## 性能與觀測

- list/autocomplete query `< 30 ms` at 10,000 tags（本地 benchmark）。
- binding query `< 50 ms`。
- 日誌只記 tag IDs/count，不記私人 display name（debug 模式除外且預設關）。

## 非範圍

- Tag hierarchy、namespace、顏色、權限。
- A04 跨 target 結果頁。
- 自動推薦 tag。

## 建議衍生任務

1. `T01-tag-normalization`
2. `T02-tag-contracts`
3. `T03-repository-crud`
4. `T04-transactional-merge`
5. `T05-system-pin`
6. `T06-tag-pickers`
7. `T07-benchmark-and-g2-review`

## Legacy 移植規則

本節點無 legacy implementation。不得以 Pin 舊碼替代完整 tag model；只能參考 pin UX。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N08.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N09-reanchor-engine.md`

---
id: N09
title: 純函數 Reanchor Engine 與批量交易
kind: core
milestone: M3
status: todo
depends_on: 
  - N05
  - N06
size: L
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread anchor recovery prototype
allowed_paths: 
  - crates/core/src/anchor/reanchor.rs
  - crates/core/src/anchor/scoring.rs
  - crates/db/src/repositories/reanchor*
  - crates/core/src/contracts/N09*
  - src-tauri/src/commands/reanchor*
  - scripts/drill-reanchor.sh
  - contracts/locks/N09.json
  - docs/tasks/N09/**
  - docs/verification/N09.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N09 — 純函數 Reanchor Engine 與批量交易

## 目標

實作保守、可測、可審計的 AnchorV1 重錨引擎，並以 document revision transaction 防止 watcher/open 競態造成 lost update。

## 輸入與前置條件

- N05 AnchorV1/canonical offset。
- N06 annotation repository/UI。
- N01 anchor event table。
- `SPEC.md` §6。

## 範圍與交付物

- `reanchor(anchor, new_text)` 純函數與所有 result/reason enum。
- Unchanged fast path、唯一 exact、具固定公式與 margin 的 context rank、fuzzy generation/scoring。
- 固定 threshold 0.82、margin 0.08、短 exact 禁 fuzzy。
- 更新 anchor context/hash/position/source-span hint；source map 無完整覆蓋時清空過期 source span；舊值寫 audit。
- `reanchor_document` 批量 command。
- 單 transaction 更新 document revision、hash、annotations、events。
- expected revision conflict。
- 開檔 trigger source 與 watcher trigger source。
- `scripts/drill-reanchor.sh`：對指定 git workspace 的相鄰 revision 回放並輸出 JSON/Markdown report。
- 真實 KB 本機回放至少 20 文件，不提交正文。

## Contract

新增：

```text
reanchor_document({
  document_id,
  expected_document_revision,
  observed_source_hash,
  canonical_hash,
  document_model_version,
  canonical_text,
  source_map_segments,
  trigger_source: "open" | "watcher" | "replay"
}) -> {
  new_revision,
  unchanged,
  shifted_exact,
  shifted_context,
  shifted_fuzzy,
  orphaned
}
```

Core public API 與 enum 必須序列化 stable code，不以 human message 作分支。

## 實作約束

- Core 零 IO/clock/DB。
- 多候選、超時、分數不足全部 orphan。
- Fuzzy 對 exact < 4 Unicode scalar 禁用；短 exact 唯一匹配仍須 context 或 256-byte position guard。
- 一份 document 一個 transaction；不得 annotation-by-annotation commit。即使 annotation count=0，source/canonical hash 的新版本也只能由此 transaction 提交。
- Conflict 時不得寫部分 event。
- 失敗不得改寫 frozen anchor。
- Adapter 必須重算 canonical hash，並在 transaction 前以 stable read 驗證 current file hash 等於 `observed_source_hash`。
- Source-map segment range 無效時回 `RENDER_MODEL_MISMATCH`，不得提交部分結果。
- Anchor/document model version 不支援或不一致時回 `UNSUPPORTED_MODEL_VERSION`；不得跨版本直接匹配。
- 性能不得以降低保守性換取。
- Algorithm threshold 變更需要 ADR + replay evidence。

## BDD 場景

### 場景 1：前方插入

**Given** annotation 錨於句 S  
**When** S 前方插入兩段，S 不變  
**Then** attached，method exact/context，range 正確平移。

### 場景 2：輕微修改

**Given** S 被小幅修改且 top score 過門檻  
**When** reanchor  
**Then** attached、outcome shifted、method fuzzy、anchor exact 更新、舊 anchor 留 audit。

### 場景 3：刪除

**Given** S 被完全刪除  
**When** reanchor  
**Then** orphaned，anchor 原樣凍結。

### 場景 4：並列候選

**Given** 兩個候選同分或 margin 不足  
**When** reanchor  
**Then** orphaned，不猜測。

### 場景 5：Revision conflict

**Given** job A/B 同時基於 revision 5  
**When** A 先提交成 6，B 再提交  
**Then** B 回 CONFLICT 且無任何部分寫入。

## 測試計畫

- Table-driven ≥ 30 cases：exact/context/fuzzy/short/duplicate/CJK/code。
- Property：在 exact 前後隨機插入/刪除且保持 exact 唯一時仍 attached。
- Mutation tests 或等價負向 corpus，確認模糊誤配被拒絕。
- Performance benchmark：1 MiB × 100 annotations `< 100 ms` core。
- Stable file-hash mismatch、DB revision conflict與 failure injection。
- Source span refresh/clear tests。
- Model version mismatch tests。
- Replay harness synthetic corpus。
- 本機真實 git history 20 文件人工抽核與統計。

## 驗收標準

- 五個 BDD 全過。
- Table/property/transaction tests 全綠。
- Core benchmark `< 100 ms`。
- 真實 replay attached（含 shifted）比例 `>= 90%`，誤配為 0；orphan 可追溯。
- Audit event 完整，無正文進日誌。
- `drill-reanchor.sh` 可重現。

## 性能與觀測

- Core benchmark獨立於 IPC/DB。
- Command 另記 core、transaction、total duration。
- 超時/候選數作 metrics；不記 exact。

## 非範圍

- Manual orphan recovery（N10）。
- Watcher event ingestion（A02）。
- 機器學習語義匹配。

## 建議衍生任務

1. `T01-result-and-error-contract`
2. `T02-exact-context-matcher`
3. `T03-fuzzy-candidate-generator`
4. `T04-conservative-scoring`
5. `T05-property-and-performance-tests`
6. `T06-batch-transaction`
7. `T07-replay-drill-and-audit`

## Legacy 移植規則

Legacy code只可作候選演算法參考。先建立新 corpus 與 property tests，再決定逐函數移植或重寫；舊 threshold/state 不具權威。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N09.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/nodes/N10-orphan-management.md`

---
id: N10
title: Orphan 列表與手動恢復
kind: core
milestone: M3
status: todo
depends_on: 
  - N09
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread unmatched annotation list and manual reanchor
allowed_paths: 
  - crates/db/src/repositories/orphans*
  - crates/core/src/contracts/N10*
  - src-tauri/src/commands/orphans*
  - src/features/orphans/**
  - contracts/locks/N10.json
  - docs/tasks/N10/**
  - docs/verification/N10.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N10 — Orphan 列表與手動恢復

## 目標

讓所有自動重錨失敗的 annotation 可被發現、理解與人工恢復，完成「永不靜默丟失」閉環。

## 輸入與前置條件

- N09 orphan status/event。
- N05 可建立新 AnchorV1。
- N06 sidebar/highlight。

## 範圍與交付物

- 全局 orphan list，按 workspace/document 分組。
- 顯示凍結 exact 的安全摘要、prefix/suffix 摘要、最後 known path、reason/event。
- 重選模式：開啟文件，使用 N05 選新 range，提交 manual reanchor。
- Manual reanchor 寫 outcome=recovered、method=manual event，持久 status=attached。
- Convert to document note：anchor null、kind/document status 更新、body 保留。
- Missing document orphan 仍可見；文件恢復後可操作。
- 批量刪除與批量轉換均不在 v1；所有恢復操作逐項執行。
- E2E：製造 orphan → 手動重錨 → 高亮恢復。

## Contract

新增：

```text
list_orphans({ workspace_id, cursor?, limit? })
manual_reanchor({
  annotation_id,
  expected_row_version,
  snapshot: DocumentSnapshotRef,
  new_anchor
})
convert_to_document_note({
  annotation_id,
  expected_row_version
})
```

Manual mutation 必須 transaction 並寫 anchor event。

## 實作約束

- Orphan 不 hard delete。
- UI 不得把 fuzzy 建議自動提交；使用者必須選取。
- Manual reanchor 必須驗證 snapshot revision/hash/model version與 current stable file hash，並確認 new anchor hashes一致。
- Convert to document note 後 body 必須非空；若原 range annotation body 空，先要求輸入內容。
- Frozen exact 可顯示，但日誌不得記錄。
- Recovered 是 event outcome；持久 status 回 attached。

## BDD 場景

### 場景 1：列出 orphan

**Given** 3 個 orphan 分屬兩文件  
**When** 開啟 orphan list  
**Then** 可見文件、凍結內容摘要、reason、最後 event。

### 場景 2：手動重錨

**Given** orphan 所屬文件仍存在  
**When** 使用者進入重選模式並選新 range  
**Then** status=attached，event=recovered/manual，高亮恢復。

### 場景 3：轉文件筆記

**Given** orphan 有非空 body  
**When** 轉為 document note  
**Then** anchor=null、status=document、離開 orphan list、內容保留。

## 測試計畫

- Repository orphan query/pagination。
- Manual reanchor revision/row-version conflict。
- State transition table。
- Convert note validation。
- React reselect mode component。
- E2E #2。
- INV-2 regression checklist/test。

## 驗收標準

- 三個 BDD 全過。
- E2E #2 綠。
- 所有 N09 orphan 都可由列表追溯。
- Manual conflict 不覆蓋新版。
- 零 hard delete 路徑。

## 性能與觀測

- 1000 orphan 分頁首屏 `< 100 ms` DB+UI。
- 日誌只記 count、reason code、IDs。

## 非範圍

- 自動語義推薦。
- 永久 purge。
- 跨文件重新綁定（v1 只允許同 document）。

## 建議衍生任務

1. `T01-orphan-query-contract`
2. `T02-orphan-list-ui`
3. `T03-reselect-mode`
4. `T04-manual-reanchor-transaction`
5. `T05-convert-document-note`
6. `T06-e2e-and-invariant-review`

## Legacy 移植規則

可移植 legacy UX 概念；狀態與 audit 必須按新模型重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N10.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

---

# FILE: `docs/templates/adr.template.md`

---
id: ADR-XXXX
title:
status: proposed|accepted|rejected|superseded
date:
deciders: []
supersedes:
affected_nodes: []
---

# ADR-XXXX — Title

## Context

只描述可驗證事實、約束與衝突。

## Decision Drivers

## Options

### Option A

### Option B

## Decision

使用 MUST/MUST NOT 描述。

## Consequences

### Positive

### Negative

### Risks

## Migration / Compatibility

## Verification

## Rejected Alternatives

## Supersession

---

# FILE: `docs/templates/implementation-plan.template.md`

---
document_type: implementation-plan
node_id:
status: draft
derived_from: []
source_version:
source_sha256: {}
generated_at:
owner:
---

# {NODE} Implementation Plan

## 1. 目標與非目標

## 2. 現況盤點

- 現有檔案/模組。
- Dependency contract 實際驗證。
- 可移植 legacy 局部。

## 3. 架構與資料流

- Component。
- Data flow。
- Transaction/concurrency。
- Error flow。

## 4. Contract Freeze Plan

| Command/Type | Source file | Test | Compatibility |
|---|---|---|---|

## 5. Data/Migration

- Schema/query/index。
- Migration order。
- Backfill/rollback。

## 6. Test-first Plan

- 首個 red test。
- BDD → test mapping。
- Failure injection。

## 7. Task DAG

```mermaid
graph LR
```

## 8. Ownership

| Task | Allowed paths | Forbidden paths |
|---|---|---|

## 9. 風險

| Risk | Evidence | Mitigation | Gate |
|---|---|---|---|

## 10. Spec Defects

| ID | Missing/ambiguous fact | Authority owner | Resolution |
|---|---|---|---|

## 11. Rollback

## 12. 完成檢查

---

# FILE: `docs/templates/node-spec.template.md`

---
id: NXX
title:
kind: core|auxiliary
milestone:
status: todo
depends_on: []
size: S|M|L
source_spec: ../../SPEC.md
source_version:
source_sha256:
revision: 1
contract_status: draft
legacy_reference: []
allowed_paths: []
forbidden_paths:
  - SPEC.md
---

# NXX — Title

## 目標

一句可驗證的結果，不描述解法偏好。

## 輸入與前置條件

- 已完成 dependency 與證據。
- 必要資料、contract、fixture。

## 範圍與交付物

- MUST deliver。
- 每項可映射到 test 或 artifact。

## Contract

- Command 名稱。
- Request/response/error。
- Version 與 compatibility。

## 實作約束

- 全局 invariant。
- Node-specific safety/concurrency/data rules。

## BDD 場景

### 場景 1

**Given**  
**When**  
**Then**

## 測試計畫

- Unit/property/component/integration/E2E。
- Negative/failure injection。
- Performance/security。

## 驗收標準

- 可機械判定。

## 性能與觀測

- Budget。
- Metrics/log redaction。

## 非範圍

- 明確禁止。

## 建議衍生任務

1. `T01-*`

## Legacy 移植規則

- 可參考什麼。
- 禁止帶入什麼。

## 完成定義

- Contract lock。
- Tests。
- CI。
- Verification。
- Metrics。

---

# FILE: `docs/templates/task-spec.template.md`

---
document_type: task
id: TXX
node_id:
title:
status: todo
depends_on: []
derived_from: []
source_version:
source_sha256: {}
owner:
allowed_paths: []
forbidden_paths: []
expected_duration: 15-90m
---

# TXX — Title

## 單一交付結果

## 前置事實與證據

## 輸入

## 修改範圍

## 禁止事項

## 執行步驟

1.

## 首個失敗測試

- Command：
- Expected failure：
- Requirement：

## 完成驗證

- Command：
- Expected result：

## Handoff

- Changed files：
- Evidence：
- Risks：
- Next task：

---

# FILE: `docs/templates/test-plan.template.md`

---
document_type: test-plan
node_id:
status: draft
derived_from: []
source_version:
source_sha256: {}
generated_at:
owner:
---

# {NODE} Test Plan

## 1. BDD Mapping

| BDD | Test ID | Level | Fixture | Oracle | Command |
|---|---|---|---|---|---|

## 2. Red State

| Test ID | Expected initial failure | Evidence path |
|---|---|---|

## 3. Unit / Property

## 4. Repository / Transaction

## 5. Component / Integration

## 6. E2E / Dogfood

## 7. Negative / Failure Injection

## 8. Security

## 9. Performance

| Metric | Dataset | Budget | Command | Hardware record |
|---|---|---:|---|---|

## 10. Regression Scope

## 11. Exit Criteria

---

# FILE: `docs/templates/verification-report.template.md`

---
document_type: verification-report
node_id:
status: draft|passed|failed
spec_version:
contract_hash:
implementation_commit:
reviewer:
verified_at:
---

# {NODE} Verification Report

## 1. 結論

- Result：
- First pass：
- Rework category：

## 2. Requirement / BDD Evidence

| Requirement/BDD | Evidence | Result |
|---|---|---|

## 3. Commands

```text
```

## 4. Contract Drift

## 5. Data / Migration / Invariants

## 6. Concurrency / Failure Injection

## 7. Security

## 8. Performance

| Metric | Result | Budget | Hardware |
|---|---:|---:|---|

## 9. Dogfood

## 10. Findings

| Severity | Finding | Resolution |
|---|---|---|

## 11. Residual Risk
