# mkfk — Agent development contract

## Scope and authority

本文件適用於 `systems/mkfk/**`。先讀 `SDD-enhanced-csr.md`（實作權威）、`SDD.md`、本次 milestone 所引用章節及 `docs/sdd/06-decisions-sources.md`。目前只有規格；不要把未執行的測試、未建立的命令或預期吞吐量描述成已完成。

安全不變量以 `SDD-enhanced-csr.md` / `SDD.md` 為準（取更嚴格者）；章節優先於 milestone 範例。發現互相矛盾時，先提出修訂及測試反例，不能挑較容易的版本實作。

## Change boundary

- 預設只改本目錄。根 README 的 mkfk 索引及專用根 CI workflow 是明確必要的例外，須在 PR 說明。
- 不改其他 component 的程式、依賴、release、部署、秘密或資料。
- 不把 sibling project 的 `AGENTS.md` 當成此目錄的繼承規則；開始工作仍須檢查當時存在的 ancestor 規則。
- 不 force-push、不刪 branch、不合併其他 PR、不自動部署或發佈 image。
- 路徑、資料格式、公共 API、持久狀態、ack/HW/ISR、epoch、membership、retention 的變更須先更新 ADR 和相應驗收。

## Implementation discipline

一次實作一個 milestone；M0 通過前不做 M1，M2 通過前不做 distributed log。M3 的 election-only 中間產物不得宣稱可安全儲存 replicated data。

核心演算法必須在專案中實作。標準庫及小型 transport/test dependency 可使用；現成 Kafka、etcd service、Raft library、SQL/Redis/RocksDB 不得替代本專案的教學核心。若希望改用成熟 Raft library，先以 ADR 更改學習目標，不得暗中替換。

所有 timer、隨機數、網路與檔案錯誤都要有可注入介面。核心狀態機不可依賴真實時間或不可控 goroutine 排程。測試使用 fake clock、固定 seed、可重播事件；`sleep` 不能作為正確性證明。

不可用全域 mutex 包住網路等待或 fsync。採每 partition 單一邏輯 owner，透過明確的 persistence-completion 事件推進狀態；傳送依賴持久性的 RPC 前必須先等 durability barrier。

不得把 timeout 當成沒有寫入；不得以改 producer identity、降低 ack、移除 ISR voter 或清空資料目錄來讓測試通過。

## Parallel work and review

Planner 維護里程碑與 acceptance IDs；storage、consensus、client/group、test writer 分別限定目錄。先固定跨模組介面及 golden vectors，再平行實作。Reviewer 不得只看 happy path；必須追蹤至少一次「已寫入但回覆遺失」及一次舊 leader 隔離的完整事件序列。

單一 writer 擁有同一份格式／協定規格。跨模組改動由整合者合併，不能让多個 agent 同時改寫契約而互相覆蓋。

## Required handoff

每個 PR 必須列出：

1. 對應 milestone、requirement/test IDs、實際變更與未做範圍。
2. 執行命令、工具鏈版本、exit code、seed、測試輸出位置；未執行要明說原因。
3. 故障注入結果、已知風險、ADR 變更及下一個可執行任務。

程式階段的基本 gate 是格式、靜態檢查、unit、race、對應 integration/model tests。命令契約見 `docs/sdd/05-roadmap.md`；在 M0 建立前不能假裝已存在。

若建立 GitHub Actions，必須放在 repository 根 `.github/workflows/`，遵守 `../../docs/specs/monorepo-ci.md`：path-scoped、`contents: read`、timeout、concurrency cancellation、action immutable SHA、checkout 不保留 credentials，不新增 publish/deploy 或 secrets。

## Safety and evidence

故障測試只對本次建立的 child processes、暫存目錄及隔離 compose network 操作。禁止用廣域 `pkill`、主機防火牆重設或刪除使用者既有 volume。測試資料不得包含真實 credentials 或私人資料；log 不記錄 payload、token、key/value 明文。

每次交接更新 milestone 狀態，保留 `NOT_STARTED` / `IN_PROGRESS` / `VERIFIED` 的區分。可編譯、可啟動、測試通過及完整 milestone 驗收是不同狀態。
