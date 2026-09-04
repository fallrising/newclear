# Task B2 Plan — fs_watcher + echo-loop guard + document I/O

| 項目 | 內容 |
|---|---|
| 任務 ID | B2 |
| 軌道 | Rust 後端（Wave 1） |
| 風險等級 | **P0** — 存檔不自我覆蓋 |
| 模式 | Manual（每階段人類確認） |
| 階段 | ① PLAN（本文）— 待 ② REVIEW |
| 依賴 | A0 凍結點（`Event::FsChanged`, `WriteCommand::WriteDocument`, `ReadCommand::ReadDocument`, `EventSink`） |

> 本文為 docs-first 階段產出，**不含任何實作代碼**。審查通過後才進 ③ IMPLEMENT。

---

## 0. 我自己回答的五個 reviewer 問題（記錄，待你 review 才採行）

1. **`notify` crate 版本**：選 **v8**（v8 在 macOS 用 FSEvents 比 v6 穩；API 略改但小）。
2. **Debounce window**：**100ms**。短到使用者編輯感受不到延遲，長到合併 IDE 的批次寫入。可由 env `LOOM_FS_DEBOUNCE_MS` 覆寫，給 P0 自驗 tuning 用。
3. **Hash 演算法**：**blake3**。不需要 crypto strength，blake3 比 sha256 快 ~5x，binary 大小幾乎沒差。
4. **Vault root 配置**：B2 收一個 `vault_root: PathBuf` 作為構造參數，**不自己讀環境變數**。讀 config 與 env 是 E0 的事，B2 接到啥就監看啥。
5. **Echo ignore window 長度**：**500ms**。watcher 事件理論上應該 < 100ms 到，但 macOS FSEvents 有時 coalesce 延遲。500ms 寬鬆但仍短到不會誤吃使用者的真實外部編輯。

---

## 1. 目標（一句話）

實作 vault 檔案系統的單向真實來源（`.md` 主資料在磁碟）、雙向同步（app ↔ 外部編輯器）、自寫忽略窗（D-7）、外部改檔衝突偵測、rename 風暴防呆；交付一個能在 mock & 真實 vault 兩種模式下對著 fixtures 驗證的 `fs` 模組。

---

## 2. 我讀了哪些上游契約 / TDD 段落

| 來源 | 段落 | 用途 |
|---|---|---|
| `contracts/src/event.rs` | `Event::FsChanged { path, change }`, `FsChangeKind` | 推給前端的形狀 |
| `contracts/src/command.rs` | `WriteCommand::WriteDocument { path, content, expected_hash }`, `ReadCommand::{OpenFile, ReadDocument}` | 我要實作的 RPC 形狀 |
| `contracts/src/origin.rs` | `Origin` | 寫類命令必帶 origin；B2 內只透傳，gate 在 B3 |
| `fixtures/fs_events/four-scenarios.json` | self-write / external / external+unsaved / rename storm | 我的對照 fixtures |
| `schema/source-of-truth.md` | `.md` 內容 = 主資料（fs），永不從 DB 重建 | 不碰 DB、不向 B1 借持久層 |
| TDD §4.1 | 檔案 vs DB 雙真相劃分 | 設計紀律 |
| TDD §5.1 / §5.2 | Document Engine + fs_watcher 邊界 | C2 自己解析 `^block-id`；B2 只給 raw 內容 |
| TDD §7.2（D-7） | echo loop 防護 + 外部改檔衝突 | 本任務核心 |
| TDD §9 | fs 事件遺漏 → 對帳掃描 / 手動 refresh 兜底 | rename 風暴退路 |
| 03 acceptance B2-1 ~ B2-5 | 我的綠燈條件 | — |

---

## 3. 範圍 In / Out

### In

1. **`FsWatcher`**（核心新元件）
   - 包裝 `notify::RecommendedWatcher`（macOS = FSEvents、Linux = inotify）
   - 接 `vault_root: PathBuf`、`debounce_ms: u64`、`event_sink: Arc<dyn EventSink>`
   - 內部 tokio task：notify event → debounce buffer → flush → 比對 echo guard → emit `Event::FsChanged`

2. **Echo-loop guard（D-7 的核心）**
   - 內部 `Mutex<HashMap<PathBuf, EchoEntry>>`
   - 結構：`EchoEntry { content_hash: blake3::Hash, expires_at: Instant }`
   - API：
     - `register_self_write(path, content_bytes)`：在自寫前呼叫；登記 path + content hash + 500ms expiry
     - `should_ignore_event(path, on_disk_hash) -> bool`：watcher 事件先過此 → 命中 hash 即 ignore
   - 過期清理：每次 register/check 都順便掃過期條目（小規模不需專屬 GC task）

3. **`DocumentService`**（高階 API，B3 / E0 都會用）
   - 構造：`DocumentService::new(vault_root, watcher_handle, fs_change_sink)`
   - `read_document(path) -> DocumentSnapshot { content: String, on_disk_hash: blake3::Hash }`
   - `write_document(path, content, expected_hash: Option<hash>) -> WriteOutcome`
     - 若 `expected_hash.is_some()` 且 ≠ 實際磁碟 hash → `WriteOutcome::Conflict { current_disk_hash }`（B2-3 的後端配合）
     - 否則：echo guard register → `tempfile + fsync + atomic rename` → 回傳新 hash
   - **檔案系統是事實來源**：read 永遠從 fs 讀，沒有 cache（block_index 是 C2/B-level cache，跟我無關）

4. **External-change conflict 偵測（B2-3）**
   - `DocumentService` 維護 `Mutex<HashMap<PathBuf, EditorState>>`
   - `EditorState { last_seen_disk_hash, has_unsaved_changes }`
   - API：
     - `mark_open(path, content)`：editor 開檔時呼叫，記錄 hash
     - `mark_dirty(path)` / `mark_clean(path)`：未存變更狀態
     - `mark_closed(path)`
   - 收到 fs_changed 時：若 `has_unsaved_changes && new_disk_hash != last_seen_disk_hash` → emit **`Event::FsChanged` with conflict marker**（見 §6 契約問題）

5. **Rename storm 兜底（B2-4）**
   - debounce buffer 內 dedupe by path（連續 modified 折成一個）
   - 額外：每 60s 一次 `reconcile_scan()`：list vault、比對上次掃描的 path set → 補發遺漏的 `created` / `deleted`
   - 對帳掃描是 fallback，正常情況 notify 已經處理；只是給 macOS FSEvents 偶爾掉事件當保底

6. **Read-only 模式（提早抓壞檔）**
   - vault_root 不存在或不可讀 → 啟動時 emit `EventSink` 一條 warning event，**不 panic**；繼續允許 `read_document` 失敗時回 `FsError::NotFound`、`write_document` 視情況建目錄
   - 對應 §9 graceful degrade

### Out（B2 **不**做）

- approve gate（B3）；B2 收到的 `WriteDocument` 已假設過 gate
- block-id 解析、`[[file#^id]]` resolution（C2 / `block_index` cache）
- canvas sidecar (`.loom/canvas.json`) 讀寫（C3 / E0）
- frontmatter parse（C2）
- Document editor UI、conflict resolution UI（C2 / C4）
- Plugin manifest 載入（D1）
- fs_watcher 在 Tauri 殼裡的 IPC 註冊（E0）

---

## 4. 我會改哪些路徑

依 `00-orchestration-master.md` §4，B2 獨佔 `src-tauri/src/fs/**`。

```
新增：
├── src-tauri/src/fs/
│   ├── mod.rs              # FsWatcher + DocumentService 對外 API
│   ├── error.rs            # FsError
│   ├── echo_guard.rs       # echo-loop guard（D-7 核心）
│   ├── watcher.rs          # notify wrapper + debounce + 對帳
│   ├── document.rs         # DocumentService (read / write / editor state)
│   └── atomic_write.rs     # tempfile + fsync + rename 共用工具

修改（append-only 規則，依 src-tauri/README.md）：
├── src-tauri/Cargo.toml    # 加 notify v8、blake3、async-channel
├── src-tauri/src/lib.rs    # 加一行 `pub mod fs;`
```

**新增 dev fixture 路徑**：
- `src-tauri/tests/vault_*/` — integration tests 用 tempdir 作 vault root（不污染 `/fixtures/`）

---

## 5. 對 mock / fixtures 的依賴

| 來源 | 用途 |
|---|---|
| `/fixtures/fs_events/four-scenarios.json` | 對照組：B2 emit 的事件形狀必須能 deserialize 成 `Event::FsChanged`（已在 A0 fixture loader 驗過） |
| 自建 tempdir vault | 大部分 integration test 對著真實 fs 跑（用 `tempfile::TempDir`） |
| 自建腳本 / 直接 Rust 操作 | 模擬「外部編輯」（另一個 thread 直接 fs::write）、「rename 風暴」（連續 50 個 rename） |

---

## 6. 契約問題 — 我預期會撞到的（請 review）

A0 凍結的 `Event::FsChanged { path, change }` 與 `FsChangeKind::{Created, Modified, Deleted, Renamed { from }}` **沒有「外部改 + 編輯器有未存變更」這個 conflict variant**。

選項：

A. **不改契約**，B2 內部把 conflict 條件透過 `FsChangeKind::Modified` 推出去，前端（C2/E0）查自己的 editor state 來判斷是否衝突。
   - 優點：契約凍結守住
   - 缺點：把判斷邏輯切兩半，前端要重做一次

B. **加一個 event**（走 RFC 流程，動契約）：`Event::FsConflict { path, on_disk_hash, last_seen_hash }`。
   - 優點：語意乾淨
   - 缺點：違反「契約凍結 → RFC」紀律；A0 之後第一張 RFC

C. **擴 `FsChangeKind`**：加 `Conflict { on_disk_hash: String, last_seen_hash: String }` variant。
   - 同 B 的缺點。

**我的預設選 A**（不改契約），理由：editor state 本來就在前端（C2 知道使用者有沒有未存變更），後端強推一個 conflict event 等於把前端 state 也搬到後端、然後雙邊都要維護一份。

但我會在 `DocumentService` 提供一個 **同步 API** `check_conflict(path)`：前端收到 `FsChanged::Modified` 後可以呼叫它確認是否真的衝突（後端有 last-known-disk-hash）。這把 hash 比較留在後端、把 dirty-state 留在前端，職責清楚。

**請你選 A/B/C 哪個。** 我預設 A 動工。

---

## 7. 關鍵設計決策落點

| 決策 | B2 的實現 |
|---|---|
| **D-1**（daemon 邊界） | `FsWatcher` / `DocumentService` 不依賴 Tauri；用既有 `EventSink` trait（B1 已有）發 `FsChanged` |
| **D-3**（origin 透傳） | `write_document(origin, ...)` 收 origin，log + 留給 B3 的 gate；B2 不做 gate |
| **D-4**（sidecar 主資料、DB 快取） | 不適用 B2（B2 寫的是 `.md`，那是主資料，根本不過 DB） |
| **D-7**（echo loop） | `EchoGuard` 是本任務核心，§3 In 第 2 點全文 |
| **§4.1**（檔案是 .md 主資料） | `DocumentService::read_document` 永遠 fs read，沒 cache |
| **§7.2**（外部改檔不靜默蓋） | §3 In 第 4 點 + §6 契約問題 |
| **§9**（rename storm fallback） | debounce + 60s 對帳掃描 |

---

## 8. 失敗模式與降級

| 情境 | B2 的回應 | 對應 acceptance |
|---|---|---|
| vault_root 不存在 | log warning event；read/write 個別 fail，但 module 仍啟動 | — |
| 自寫觸發 fs event | echo guard 命中 → silent drop | B2-1 |
| 純外部編輯（無未存） | 正常 emit `FsChanged::Modified` | B2-2 |
| 外部 + 有未存 | emit `FsChanged::Modified`；前端用 `check_conflict()` 比 hash | B2-3 (§6 選項 A) |
| rename 50 個 | debounce 合併；對帳掃描補漏 | B2-4 |
| disk full / readonly | `WriteOutcome::IoError(io::Error)`；不 retry，回給呼叫方 | — |
| 自寫過程 panic | `tempfile` 自動清理；原檔不被破壞 | B2-5 |
| notify backend 死掉 | 嘗試 restart watcher（最多 3 次）；都失敗 → emit error event，60s 對帳掃描變唯一 source | — |

---

## 9. 自驗計畫（對應 03-acceptance B2）

| # | 驗收項 | 我怎麼證明 |
|---|---|---|
| B2-1 | 自寫不觸發 reload | integration test：`DocumentService::write_document` → 觀察 `EventSink`，500ms 內**不應**收到任何 FsChanged for that path |
| B2-2 | 純外部改檔 → 正常 reload | integration test：另一個 thread `fs::write` → `EventSink` 應收到 `FsChanged::Modified` |
| B2-3 | 外部 + 未存 → 不靜默 | integration test：`mark_open` + `mark_dirty` → 外部 write → 應收到 `FsChanged::Modified` + `check_conflict()` 回 true |
| B2-4 | rename 風暴 | integration test：50 個 rename 串著做 → debounce 後 batched 事件數 ≤ 25；對帳掃描 path set 對得上 |
| B2-5 | .md 主來源在 fs | integration test：write 一份 .md → 直接 `std::fs::read` 驗證內容 byte-for-byte；DocumentService 沒有任何 cache |
| — | 通用：洪峰不 crash | 1000 個檔案 sequential write，無 panic |
| — | 通用：clippy + fmt | `cargo clippy --all-targets -- -D warnings` 全綠、`cargo fmt --check` 全綠 |

加一條 demo：`examples/fs_demo.rs` 跑一個 watcher + 印事件，類似 `pty_demo` 給你看得到。

---

## 10. 風險與預期撞到的停止條件

| 風險 | 觸發點 | 對應停止條件 |
|---|---|---|
| **§6 契約衝突** | 我選 A 但你選 B/C | §4-1（要改契約）→ RFC |
| **macOS FSEvents 偶爾延遲到 >500ms** | echo window 內事件沒到 | 不算停止條件；對帳掃描兜底。Plan 內接受小機率漏網 → 60s 後對帳補正 |
| **`notify` v8 在 macOS 對 symlink / case-insensitive 行為** | vault 內有 symlink | 未驗過。Plan 內標 v1 不支援 symlink；對帳掃描幫一點忙 |
| **debounce 與「使用者快速 ctrl-S 兩次」混淆** | 100ms 內兩次自寫 | echo guard 是 per-path-hash，不是 per-event，兩次自寫不同內容會分別 register → 兩個 hash 都比對成功，不誤判 |
| **檔案內容很大（> 100MB）** | hash 慢 | blake3 ~3GB/s，1GB 仍 < 1s。Plan 內接受；超過 100MB 在 log 警告 |
| **連續審查或自驗失敗 ≥ 2** | integration test 不過 | §4-2（連兩輪打回）→ 停 |
| **觸 approve gate 邊界** | `write_document` 沒帶 origin | §4-3（安全相關 → 停下喚人） |

---

## 11. 預估工作量

- `FsError` + crate 殼：~0.3 session
- `EchoGuard` + 單元測試：~0.7 session
- `FsWatcher` notify wrapper + debounce + 對帳：~1.5 sessions
- `atomic_write`：~0.3 session
- `DocumentService` read/write + editor state：~1 session
- Integration tests（B2-1 ~ B2-5）：~1.5 sessions
- `examples/fs_demo.rs`：~0.3 session

合計 **~5.6 sessions**。Manual mode 下每段都會停。

---

## 12. 依賴清單（要加進 workspace `Cargo.toml`）

```toml
notify        = "8"           # v8 macOS FSEvents 比 v6 穩
blake3        = "1"           # echo guard hashing
async-channel = "2"           # MPMC for fs event distribution（可選；可能用 tokio mpsc 取代）
```

`tempfile` 已在 dev-deps。

---

## 13. 等待 ② REVIEW

請對照：
- TDD §5 / §7.2 / §9 我有沒有漏接
- §6 契約問題你選 A / B / C
- §0 五個自答結論（notify v8 / 100ms debounce / blake3 / vault_root 注入 / 500ms echo window）有沒有要改
- 所有權地圖：`src-tauri/src/fs/**` 邊界守住
- 預估 ~5.6 sessions 合理嗎？

**狀態回報**（協作 §7）：

```
[B2] PLAN · WAIT-HUMAN · B2 計畫已交，等 review §6 契約決定與其他確認 · 下一步：依回饋修計畫或進 ③ IMPLEMENT 第一段（FsError + crate 殼 + EchoGuard）
```
