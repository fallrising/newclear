# ERU-008：所選 worker 的 HTTP 守護配對準備

更新：2026-09-24 00:42 UTC。**ERU-008 仍進行中**；本輪只改 controller 程式、本機測試與唯讀實機計畫，沒有新建 workload，也沒有中斷既有 24 小時觀測。

`canary-start` 新增 `--exclude-node worker-2|worker-3|worker-4`，意思是**保持該目標空白**，在另兩台 worker 各建立一個 run-owned nginx。省略時仍是原 worker-2＋worker-3 配對，供 worker-4 重裝及既有觀測。計畫固定 `guard_exclude`、兩台 guard 節點與實際 mutation aliases，執行時再驗證配對與全群空 workload；每個 create 的 owner/run/placement、HTTP、其他節點及主機身分仍須核對。`guard_targets` 同時檢查 evidence 的節點、SSH alias、兩個精確 workload ID；worker readiness 要求 guard 不落在選定目標。`soak.py` 明確只接受原 worker-2＋worker-3 配對，避免把 worker-4 的 HTTP 當成目前 V11 的固定兩台結果。

本機 186 項測試通過，包括三種配對、已建立 canary 的選定 03／04 執行路徑模擬、錯誤 alias／配對、目標 02 未被改動。B→VPS 唯讀計畫 `20260924T004232Z-1354c947` 選定空目標 worker-2、列出 guard worker-3＋worker-4 及精確 aliases；因目前觀測的 02／03 nginx 尚在，`executable=false`，blocker 為全群 workload 非空。此計畫只作證明，不可在觀測後重播；私有完整內容在 `private/operations/plans/`。

後續必須先完成 ERU-002 證據判讀、ERU-003 精確清理。然後以新的 canary plan 在目標外建立守護，並補齊 **worker-2／3 的 quarantine、installer、恢復 CLI 與失敗後歸屬**；目前 `rebuild-node` 對 peer 仍明確阻擋 execute。完成本機故障測試後，再逐台按新 plan／hash 做實機重裝、HTTP、配額與其他節點保留驗收。歷史唯讀身分核對見 [上一階段](M2-WORKER-PEER-PREP-2026-09-23.md)。
