# T-0441 — M4 圖更新與有向呼叫路徑

Owner 已接受 M4 建議（「好，按你建議。」），desk #308 認領。既有 M1～M3 證據與 AC 不回溯修改。

## 範圍與設計

新增 opt-in `workspace --source ... serve-live`；既有 `serve` 保留原生固定 snapshot 行為。
本機 stdio MCP 暴露五個明確工具：`workspace_status`、`refresh_workspace`、`query_graph`、`source_excerpt`、`calls_path`。
不代理上游有外部副作用的工具。query 用已鎖定的真 Graphify CLI；source 用共用 helper；圖仍由原本 ensure_index 建立。
所有回應包含 index_id 與 snapshot provenance（成功查詢）或明確錯誤；stale/read failure 不回傳舊查詢正文。

狀態檢查不建圖：比較來源 fingerprint、context、runtime 與 graph digest。每個讀取工具在工作前後驗證，期間變動就丟棄結果。
刷新為明確操作：沿用 ensure_index 原子快取；新候選全部驗證成功才換 active pointer。失敗保持舊 pointer，狀態仍按真實當前內容判斷，不把舊圖冒充最新。
每 session 序列化刷新與讀取；無 watcher、背景 polling、自動刷新或跨 client push notification。檢查不能鎖住外部編輯器；只聲明驗證時點有效。
`calls_path` 對 graph 的有向 calls 邊作有界 BFS，拒絕猜測同名候選，區分無路徑與搜尋上限；contains 不參與。
預設32 hops、10000 visited，上限100 hops／100000 visited，排序確保結果可重跑。ID優先，否則唯一exact label；同節點0-hop有效，非函式語義與動態呼叫完整性不保證。

## 固定驗收

| AC | Given / When / Then | 結果 |
| --- | --- | --- |
| L-01 | 已開啟session；來源或ancestor設定變動後status為stale，query/source/path拒絕舊內容，status不自動建新索引；刪除／讀取錯誤／graph損壞亦不冒充current。 | 見任務板 |
| L-02 | 明確refresh成功才換index；同內容重用，rename後新符號可查，舊graph保留；失敗保留active pointer且後續不回傳舊查詢；可修復後刷新恢復。 | 見任務板 |
| L-03 | 真Graphify三層calls鏈正向可達，反向／contains-only／不相關節點不可達；同名拒絕，cycle終止，hop/visited界限有明確結果。 | 見任務板 |
| L-04 | 真stdio同一session完成初始化／列舉／查詢→修改→過期拒絕→刷新→新結果，另驗刷新失敗與恢復；與source／graph指標一致。 | 見任務板 |
| L-05 | 原56tests／7scenarios／M2pilot／M3trial，新回歸與真MCPjourney、repo gates、獨立審查、必要CI及正常merge/readback通過；帳本同步。 | 見任務板 |

## 邊界與投入

固定Graphify0.9.97與既有hash lock；沒有新runtime dependency、付費API、全域client設定、release或deploy。只讀明確來源、不執行被索引程式。
開始2026-10-29T18:08:39Z，估計60–90主動分鐘，每20分鐘checkpoint；每問題兩次有理由修正、每head CI15分鐘。
測量與provider未知值分開，無可靠來源為null。最終進度與合併事實以[任務板](../tasks/BOARD.md)為準。
