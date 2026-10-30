# T-0443 — M5 修改影響與測試線索

Owner 已接受 M5 提案並指示取任務開發；[desk 認領 #317](https://github.com/fallrising/desk/pull/317) 已合併。
本文件在實作前固定範圍與 I-01～I-05；M1～M4 的契約及歷史證據保留。

## 設計與範圍

在 opt-in `serve-live` 新增 `change_impact` 工具，必填 `target` 為 exact ID 或唯一 exact label，ID 優先；同名與未知節點拒絕。
沿現有真 Graphify 圖的 `calls` 邊反向 BFS，回傳直接及間接呼叫者；目標本身不列入，即使有環。
只查 calls，contains、相同名稱或檔案共置都不構成影響證據。結果的 `direction` 是 `reverse`；每個證據路徑仍依 caller→target 的正向 calls 排列。
每個 caller 含原節點 metadata（含可用的 source_file/source_location）、hops、direct、path 節點與原 edges。
相同長度路徑以排序節點 ID 決定，parallel edges 取穩定序列化最小值；不修改輸入圖。共用 M4 的節點／calls 邊驗證與解析規則。

Python 測試線索是可解釋的命名啟發：caller 的 label 去除 `()` 並取最後一段後以 `test_` 開頭，且 source_file 是 `.py`，位於 `test`/`tests` 目錄或檔名 `test_*.py`/`*_test.py`。
`test_hints` 只引用已回傳 caller 的 ID 及規則原因；不執行來源、測試或測試發現，不保證框架收集、覆蓋、其他語言或動態呼叫完整性。未命中是沒有本次圖／規則線索，不代表不用測試。

界限：`max_hops` 預設32、範圍1～100；`max_visited` 預設10000、範圍1～100000（含目標）；`max_results` 預設100、範圍1～1000（不含目標）。bool／非整數／越界拒絕。
到達限制而仍有未發現 caller 時回傳 `status: limit_reached` 和 `reasons`；保留已找到結果，不能宣稱完整。完全走完可達圖才為 `complete`，可能含空 callers。
排序 BFS 確保穩定結果；僅限制遍歷與輸出，不宣稱 graph 載入或整圖驗證有界。

工具透過 M4 `LiveWorkspace.execute` 在前後檢查 freshness；過期或失敗不得回傳舊正文。成功帶 index_id 與 fingerprint/digest；明確 refresh 後查新結果。
不加 watcher、自動刷新、全域 client 設定、CLI 子命令、新依賴或 Graphify 升級。原 `serve` 不變。

## 驗收

| AC | Given / When / Then |
| --- | --- |
| I-01 | 真 Graphify 解析含直接／間接呼叫、環、無關及同名符號的 source；查 target 時只列 calls 可達 caller、方向與行號可回讀，同名拒絕而 exact ID 可用。 |
| I-02 | 可達與無關 Python 測試及誤導名稱並存；只將已找到且符合公開命名規則者列為 hints，附理由與限制；不得宣稱完整測試選擇。 |
| I-03 | 分支／環／等長路徑／parallel edges 及三種限制；結果穩定、輸入不變、目標不重複，截斷與空完整結果可區分，非法參數拒絕。 |
| I-04 | 真 stdio MCP 同 session 列舉新工具、查影響與 source、修改→過期拒絕→明確刷新→新 caller／hint／provenance，含非法參數負例。 |
| I-05 | 原81tests及7真場景/M2pilot/M3trial、新回歸、repo index/workflow gates、獨立審查、必要CI、PR合併與回讀、desk/journal同步完成。 |

## 執行與證據

基準 `6b7bf17c010f6a354f7abf3676f994f7ae2d19ec`，Graphify0.9.97／Python3.12／既有 hash lock。
開始2026-10-30T03:55:13Z，估計45–75主動分鐘（含一位獨立reviewer），每20分鐘檢查；同問題最多兩次有理由修正、每head CI15分鐘。
初次 setup 沙箱 DNS 失敗，按既有 lock 以允許網路執行重試；不是產品測試失敗或成功。provider requests/tokens/cost未知為null。
完成依據與合併事實以[任務板](../tasks/BOARD.md)及本輪證據為準。無release／deploy或下一里程碑。
