# Task B1 Plan — pty_manager + ring buffer + session_store

| 項目 | 內容 |
|---|---|
| 任務 ID | B1 |
| 軌道 | Rust 後端（Wave 1） |
| 風險等級 | **P0** — re-attach 保真，產品第一印象 |
| 模式 | Manual（每階段人類確認） |
| 階段 | ① PLAN — ② REVIEW 已通過 — 進入 ③ IMPLEMENT |

## 0. Reviewer 五問的決議（自行回答後採行）

1. **跨軌共用入口**：B1 建 `src-tauri/Cargo.toml` 與 `src-tauri/src/lib.rs`；後續軌道只能 append 自己的 `pub mod xxx;`。規則寫進 `src-tauri/README.md` 取代既有 placeholder。
2. **`dropped_old` 語意**：**per-batch（自上次 emit 累計）**。在 `pty::batcher` doc comment 與 `contracts::PtyBatch` doc 同步註解。
3. **SQLite 損壞**：empty in-memory fallback；log error；發一次 toast event（B3 接 UI 時取用）。不拒絕啟動。
4. **ring buffer cap**：預設 10000 frames；`LOOM_PTY_RING_CAP` env var 覆寫，用於 P0 自驗 tuning。
5. **Windows**：v1 跳過。`portable-pty` 已含 ConPTY 支援，未來打開 feature。README 標記。
| 依賴 | A0 凍結點（contracts、`SessionMeta`、`PtyBatch`、`SessionState`） |

> 本文為 docs-first 階段產出，**不含任何實作代碼**。審查通過後才進 ③ IMPLEMENT。

---

## 1. 目標（一句話）

實作 PTY 生命週期管理（spawn / kill / resize）、後端 ring buffer 合批推送（D-2）、view subscription 與 PTY 解耦（D-5）、session metadata 持久化、啟動時的 re-attach / tombstone graceful degrade（§7.1）；交付一個能在不接 Tauri 殼的情況下對著 fake subscriber 與真實 PTY 走通閉環的 `loom-core` 模組。

---

## 2. 我讀了哪些上游契約 / TDD 段落

| 來源 | 段落 | 用途 |
|---|---|---|
| `contracts/src/stream.rs` | `PtyBatch { stream_id, session_id, frames, dropped_old }` | 推送的形狀；`dropped_old` 必須誠實 |
| `contracts/src/command.rs` | `WriteCommand::{SpawnPty, KillPty, ResizePty, AttachSessionView, DetachSessionView}` | 我要實作的命令集 |
| `contracts/src/event.rs` | `Event::PtyExited { session_id, exit_code }` | 退出事件形狀 |
| `contracts/src/session.rs` | `SessionMeta` / `SessionState { Spawning, Active, Detached, Exited, Tombstone }` | 持久化形狀；tombstone 帶 `reason` |
| `contracts/src/origin.rs` | `Origin` | 寫類命令必帶 origin（B3 才接 gate，B1 只透傳） |
| `schema/sqlite.md` | `sessions` table 概念 schema | 我要對著它建表 |
| `schema/source-of-truth.md` | session metadata 是「main (degradable)」 | boot 還原失敗時走 tombstone，不從 DB 重建 PTY |
| TDD §2.1（D-1） | core ↔ GUI 介面按「彷彿 socket 呼叫」設計 | 我不假設同進程；用 trait 抽象 sink |
| TDD §3.1 並發模型 | per-PTY async task、bounded channel、單一 db_writer + WAL | 我的 task topology 對著這個 |
| TDD §3.2 / D-2 | per-PTY ring buffer、每幀（16–33ms）合批、丟舊不丟新 | ring buffer 是 D-2 的核心 |
| TDD §5.1 / 5.3（D-5） | PTY 生命週期與 view 解耦；view 只在 zoom-in/focus 掛載 | subscribe / detach 是純後端事 |
| TDD §7.1 | 啟動 re-attach 失敗 → tombstone + 一鍵重啟，**不 crash** | boot recovery 的紀律 |
| TDD §7.5 | ring buffer 三用途（re-attach、zoom-in 還原、zoom-out summary） | C1 要的 summary 也走同一個 buffer，但 B1 不做 summary |
| TDD §9 | 失敗模式表 | re-attach 失敗、SQLite 損壞、輸出洪峰的降級行為 |
| 03 acceptance B1 | B1-1 ~ B1-6 | 我的綠燈條件 |

---

## 3. 範圍 In / Out

### In

1. **`src-tauri/` crate 啟動（基礎設施）**
   - 新增 `src-tauri/Cargo.toml`（workspace member，depends on `loom-contracts`）
   - 新增 `src-tauri/src/lib.rs`，只宣告 `pub mod pty;` 與 `pub mod session_store;`
   - 更新 root `Cargo.toml` workspace members，加入 `"src-tauri"`
   - **這部分是「先到先建」，但 lib.rs 是未來其他 B-track 也要加 mod 行的共用入口；本 plan 在 §5 說明協調規則**

2. **PTY lifecycle（`src-tauri/src/pty/`）**
   - `PtyManager`：對外的入口，持有所有活著的 `PtySession`
   - `PtySession`：單一 PTY 的封裝（spawn / kill / resize / wait_exit）
   - 用 `portable-pty` crate 跨平台（v1 鎖 macOS + Linux；Windows 留未來）
   - 穩定 `SessionId`：UUIDv7 編碼為字串，保證單調 + 全域唯一

3. **Backend ring buffer（D-2 的核心）**
   - 每個 session 一個 `RingBuffer<Frame>`，bounded（預設 10000 frames，可調）
   - Frame = 一次 PTY read 的 UTF-8 化結果（使用 `from_utf8_lossy`，PTY ANSI 是純 ASCII 安全）
   - 滿時丟舊：`VecDeque::pop_front` 後 push_back，遞增 `dropped_old` counter
   - 累積式 `write_index` 用於 subscriber 「上次看到哪」追蹤

4. **Per-PTY reader task**
   - tokio task：循環 `read(master_fd)` → 切 frame → push 進 ring buffer
   - 用 `tokio::io::AsyncReadExt`（portable-pty 的 reader 在 blocking thread + channel 包裝）
   - PTY exit：reader 偵測 EOF → 標記 session 為 `Exited { code }` → 發 `PtyExited` 事件 → 留 ring buffer 內容（detach 後 ring 可被讀但不再寫）

5. **Frame batcher（合批推送）**
   - 每個被 attach 的 session 有一個 batcher tokio task
   - `tokio::time::interval(Duration::from_millis(20))`（~50fps，在 16–33ms 範圍內）
   - 每 tick：rev-scan ring buffer 從 subscriber.last_seen → 收集新 frames → 包成 `PtyBatch { dropped_old: 自 last_batch 起累積的丟棄數 }` → 透過 `BatchSink` trait 推出
   - 無新 frame 不推空 batch（避免 noise）

6. **Subscribe / detach（D-5 分離）**
   - `subscribe(session_id, sink)`：登記 subscriber，**立即推一個 replay batch**（ring buffer 全內容），啟動 batcher
   - `detach(session_id)`：停 batcher task；PTY reader 繼續寫 ring buffer（保留 detach 期間輸出）
   - 一個 session 同時只有一個 subscriber（v1；多 window 留未來）

7. **`BatchSink` trait + `EventSink` trait（D-1 daemon 邊界）**
   - 不依賴 Tauri，B1 只暴露 trait
   - 生產：E0 wiring 寫 `TauriSink { app: tauri::AppHandle }`
   - 測試：`VecSink { batches: Mutex<Vec<PtyBatch>> }` 收集斷言用
   - 這是「彷彿遠端 socket 呼叫」（D-1）的具體落點

8. **`session_store/`（SQLite 持久化）**
   - `rusqlite` + WAL 模式 + 單一 db_writer 模式（簡化：sync rusqlite 跑在 `tokio::task::spawn_blocking` 內）
   - schema 對應 `schema/sqlite.md` 的 `sessions` table
   - CRUD：`insert_session` / `update_state` / `update_last_activity` / `list_sessions` / `delete_session`
   - schema migration：v1 初始版，無遷移；未來用 `user_version` PRAGMA

9. **Boot recovery（§7.1）**
   - 啟動時 `list_sessions` → 對每個 `state in {Active, Detached, Spawning}` 嘗試 re-attach
   - **MVP 預設 re-attach 必失敗**（app 全退出，PTY 已死）→ 標記 `Tombstone { reason: "process not found after restart" }`
   - 暴露 `restart_from_tombstone(session_id) -> Result<SessionId>`：用原 `cwd / cmd / shell` spawn 新 PTY，產生新 SessionId（舊 tombstone 保留作歷史）
   - **絕不 crash**：所有 IO error 走 `Result` → 升級為 tombstone

### Out（B1 **不**做）

- xterm 渲染、ANSI → HTML 轉換、LOD summary 計算（C1）
- canvas 上 PTY node 的擺放（C3）
- approve gate / origin 檢查（B3 之後接；B1 收到的 Command 假設已過 gate）
- AI bridge / MCP host（B4 / B3）
- 多視窗 / 多 subscriber per session
- Windows 平台（macOS / Linux 先過 P0）
- Tauri 殼、icon、tauri.conf.json
- 真實「tray 常駐 → 關窗存活」端到端（E0；B1 只交模組，殼是 E0 的事）

---

## 4. 我會改哪些路徑

依 `00-orchestration-master.md` §4 所有權地圖，B1 獨佔 `src-tauri/src/pty/**` 與 `src-tauri/src/session_store/**`。

```
新增：
├── src-tauri/
│   ├── Cargo.toml                          # 啟動 crate（見 §5 協調）
│   └── src/
│       ├── lib.rs                          # 啟動入口，宣告 pub mod（見 §5）
│       ├── pty/
│       │   ├── mod.rs                      # PtyManager 對外 API
│       │   ├── session.rs                  # PtySession 結構
│       │   ├── ring_buffer.rs              # RingBuffer + Frame + drop-old
│       │   ├── reader.rs                   # per-PTY reader task
│       │   ├── batcher.rs                  # frame batcher + BatchSink trait
│       │   └── sinks.rs                    # VecSink 測試實作
│       └── session_store/
│           ├── mod.rs                      # SessionStore 對外 API
│           ├── db.rs                       # rusqlite schema + CRUD
│           └── recover.rs                  # boot re-attach + tombstone

修改：
├── Cargo.toml                              # 加入 "src-tauri" 到 workspace.members；
│                                          #   workspace.dependencies 加 portable-pty / rusqlite / tokio / tracing / uuid
```

**新增 dev fixture 路徑**（B1 自己的測試用，不污染 `/fixtures/`）：
- `src-tauri/tests/fixtures/` — 給 integration test 用的 shell 腳本（製造洪峰、長跑、立即退出）

---

## 5. 跨軌共用入口的協調規則（必要）

`src-tauri/Cargo.toml` 與 `src-tauri/src/lib.rs` 嚴格來說不在 B1 ownership 內，但**必須有人先建**才能讓 B-track 編譯。本 plan 提案：

| 檔案 | 規則 |
|---|---|
| `src-tauri/Cargo.toml` | B1 建立；後續 B2/B3/B4/D1 **可以** append `[dependencies]` 行，**不可** 修改 B1 寫的條目 |
| `src-tauri/src/lib.rs` | B1 建立並只宣告 `pub mod pty; pub mod session_store;`；後續軌道**只能** append 自己的 `pub mod xxx;` 行 |

**這是不得已的妥協**。理想做法是 A0 應該先建好空殼，但 A0 plan 已經凍結。我若覺得這違反所有權地圖過大，提案兩個 alternative 在 §10 等 review。

---

## 6. 對 mock / fixtures 的依賴

| 來源 | 用途 |
|---|---|
| `/fixtures/pty_stream/example.jsonl` | 對照組：B1 自己跑真 PTY 產出的 PtyBatch 形狀應與此一致；用 `serde_json` 比對 |
| 自製 shell 腳本（`src-tauri/tests/fixtures/flood.sh`） | 產 10000 行洪峰測 B1-1/B1-2 |
| 自製 shell 腳本（`long_running.sh`） | 跑 sleep + echo 兩次，用於測 detach / re-subscribe 中間期是否保留輸出 |
| 自製 shell 腳本（`exit_fast.sh`） | 立即 exit 0，測 reader 偵測 EOF + `PtyExited` 發送 |

---

## 7. 關鍵設計決策落點

| 決策 | B1 的實現 |
|---|---|
| **D-1**（daemon 邊界） | 用 `BatchSink` / `EventSink` trait 抽象「往前端推」，真實 Tauri 在 E0 接；測試用 `VecSink` |
| **D-2**（合批 + 丟舊） | RingBuffer 用 `VecDeque<Frame>`，cap = 10000；batcher tokio interval = 20ms；`dropped_old` 在 PtyBatch 上誠實回報 |
| **D-3**（origin 透傳） | B1 不做 gate，收到的 `WriteCommand` 已含 origin；用於日後稽核（B3）。B1 內部 spawn / kill 都記錄 `origin` 進 trace log |
| **D-4**（sidecar 主資料、DB 快取） | 不適用 B1（B1 動的 `sessions` 是 main-degradable，不是 sidecar 的鏡像） |
| **D-5**（PTY / view 解耦） | reader task 是 session 一存在就跑；batcher task 只在 subscribe 時起、detach 時停。ring buffer 不論有沒有 subscriber 都寫 |
| **§3.1 並發** | tokio multi-thread runtime；db 寫入透過 `tokio::task::spawn_blocking` 跑 sync rusqlite；以單一 mpsc 序列化 DB 寫操作（避免多任務並發寫） |
| **§7.1 graceful** | 所有 PTY / DB error 走 `Result`，最終升級為 tombstone；boot 過程中**任一** session 失敗都不傳染給其他 session |
| **§3.2 stream id** | 每次 `subscribe` 產生新 `StreamId` (UUIDv7)；replay batch 與後續 tick batch 共用同一 stream_id |

---

## 8. 失敗模式與降級

| 情境 | B1 的回應 | 對應 acceptance |
|---|---|---|
| `cat largefile` 洪峰 | 合批 + 丟舊；`dropped_old` 累計回報 | B1-1, B1-2 |
| Subscribe 已掛掉的 session | 立即推 replay batch（ring buffer 殘留） + 緊接一個 `PtyExited` event | — |
| Reader EOF（PTY 死掉） | 標記 `state = Exited { code }`，發 `PtyExited`；ring buffer 保留 | B1-5 部分 |
| Boot 找不到 PTY process | tombstone + 一鍵 restart；**不 crash** | B1-5 |
| SQLite 損壞 / 不可讀 | 啟動時 log error；**回退到 empty in-memory store**，仍允許 spawn 新 session（喪失歷史 session，符合 §9 「DB 損壞快取重建、主資料降級」） | E0-C3 部分 |
| `portable-pty` spawn 失敗（cmd not found） | 回 `Err(SpawnError)` 給呼叫方；不寫入 `sessions` table | — |
| Resize 在已死 session | 回 `Err(SessionNotFound)`；不 crash | — |
| ring buffer 高速寫 + slow subscriber | 寫不受 subscriber 影響（subscriber 只 read），故無 backpressure 反推 PTY；slow subscriber 的下一 tick 一次拉多 frame，內含 `dropped_old > 0` 警示 | B1-2 |

---

## 9. 自驗計畫（對應 03-acceptance B1）

| # | 驗收項 | 我怎麼證明 |
|---|---|---|
| B1-1 | 洪峰不打爆 + 合批 | integration test：spawn `flood.sh` (10000 行)；用 `VecSink` 收集；總 batch 數應遠小於 10000；每個 batch frames 多個 |
| B1-2 | channel 滿丟舊不丟新 | integration test：ring cap = 100，灌 5000 行；最後一個 batch 末尾應該是 "line 5000"，`dropped_old` 總和應 ≈ 4900 |
| B1-3 | detach → re-attach 完整 replay | integration test：spawn `long_running.sh`，等輸出 → detach → 等再多輸出 → re-subscribe；第一個 batch 應包含整段內容 |
| B1-4 | 關窗→重開（同 process 內） | 模擬：拿 `PtyManager` 實例直接呼 detach / subscribe；B1-3 的進階版（B1 自己無法真的「關窗」，那是 E0 殼層） |
| B1-5 | re-attach 失敗 → tombstone + 重啟 | integration test：手動構造一個指向不存在 PID 的 `sessions` row → 跑 `recover()` → 確認結果是 tombstone、`restart_from_tombstone` 能成功 spawn 新 PTY |
| B1-6 | metadata 持久化 + 還原 | integration test：spawn → check DB row → 殺 PtyManager → 新 PtyManager 載入 → assert metadata 等於 spawn 當時 |
| — | 通用：洪峰不 crash | `cargo test --release` 跑 B1-1，確認無 panic、無 stack overflow |
| — | 通用：clippy / fmt | `cargo clippy --all-targets -- -D warnings` 全綠、`cargo fmt --check` 全綠 |

**單元測試額外**：ring buffer 的 push / evict / iterate_since 三個操作各自獨立測。

---

## 10. 風險與我預期會撞到的停止條件

| 風險 | 觸發點 | 對應停止條件 |
|---|---|---|
| **A0 沒幫 src-tauri 開殼** | §5 描述的協調問題 | §4-6（要動別人擁有的路徑）。提案兩個 alternative：(A) 我建空殼 + 寫死「後續軌道只 append」規則；(B) 提 RFC 退回 A0 補做 |
| **`Tauri AppHandle` 在 B1 不可用** | E0 才會接 Tauri 殼 | 不算停止條件；我用 trait `BatchSink` / `EventSink` 抽象 |
| **portable-pty Windows 不可用** | 我跳過 Windows | §4-5（規格歧義）？不是；TDD 沒指定平台，但 MVP 共識是 macOS。我 plan 內明確標 v1 = macOS+Linux，未來補 Windows |
| **rusqlite 編譯重 / cross-compile 慢** | bundled sqlite 編譯首次 ~1min | 非停止條件；接受 |
| **dropped_old 語意**：算「自上次推送以來」還是「自 session 起算」？ | A0 contract 沒講清楚 | §4-5 規格歧義。我 default 選「自上次推送以來」（更實用，前端能畫 toast「剛剛丟了 N 行」），plan 標記等 review 確認 |
| **`StreamId` 與 `SessionId` 對應關係**：1:1？多視窗 1:N？ | A0 contract 沒講 | §4-5。我 default v1 = 1:1（一個 session 同時最多一個 subscriber/stream），plan 標記 |
| **連續 P0 自驗失敗 ≥ 2** | integration test 不過 | §4-2（連兩輪打回）→ 停 |
| **觸及 approve gate 語意** | 我說不做，但若 B3 早於 B1 落地 origin 透傳邏輯有歧義 | §4-3 安全。B1 內只「透傳 + log」，不解釋語意 |

**對 reviewer 的具體請求**：
1. §5 跨軌共用入口協調規則同意嗎？（最重要）
2. `dropped_old` 語意（per-batch 累計 vs 自 session 起算）哪個對？
3. SQLite 損壞時「empty in-memory fallback」是否過度？要不要直接拒絕啟動？
4. ring buffer cap 預設 10000 frames，可接受嗎？要做成 config 嗎？
5. Windows 暫不支援，OK 嗎？

---

## 11. 預估工作量

- `src-tauri` 殼啟動：~0.5 session
- ring buffer + 單元測試：~1 session
- PtySession + reader task：~1.5 sessions
- batcher + sink trait + 整合：~1 session
- session_store schema + CRUD：~1 session
- boot recovery + tombstone restart：~1 session
- integration tests（6 個驗收項）：~1.5 sessions

合計 **~7.5 sessions**。Manual mode 下每段都會停。

---

## 12. 依賴清單（要加進 workspace `Cargo.toml`）

```toml
# runtime
portable-pty       = "0.9"      # PTY (Unix openpty + Windows ConPTY)
tokio              = { version = "1", features = ["full"] }
rusqlite           = { version = "0.32", features = ["bundled"] }
uuid               = { version = "1", features = ["v7"] }
tracing            = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
parking_lot        = "0.12"
thiserror          = "1"
async-trait        = "0.1"      # 為 sink trait 異步化

# dev
tokio-test         = "0.4"
tempfile           = "3"
pretty_assertions  = "1"
```

`loom-contracts` 已是 workspace member，B1 直接引用。

---

## 13. 等待 ② REVIEW

請對照：
- TDD §2.1 / §3 / §5.1 / §5.3 / §7.1 / §7.5 我有沒有漏接
- 所有權地圖：§5 描述的跨軌入口協調是否可接受
- 風險清單 §10 的五個 reviewer 問題是否有結論
- 預估工作量 §11 是否合理（manual mode 大約 7.5 sessions ≈ 7.5 次審查迴圈）

**狀態回報**（協作 §7）：

```
[B1] PLAN · WAIT-HUMAN · B1 計畫已交，等 review 五個關鍵問題 · 下一步：依回饋修計畫或進 ③ IMPLEMENT 第一段（src-tauri 啟殼 + ring buffer 單元測試）
```
