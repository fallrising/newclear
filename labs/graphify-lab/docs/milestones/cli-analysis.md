# T-0444 — M6 命令列呼叫路徑與影響查詢

Owner 在 M5 交付後要求繼續開發；延續取任務授權。[desk 認領 #324](https://github.com/fallrising/desk/pull/324)已合併後才寫本輪文件及實作。
本切片將既有分析提供給終端／腳本，不修改 M4/M5 的圖演算法、hint 規則或既有 MCP 契約。

## 範圍與介面

`python -m graphify_lab.workspace --source DIR [--cache CACHE] calls-path FROM TO [--max-hops N] [--max-visited N]`

`python -m graphify_lab.workspace --source DIR [--cache CACHE] impact TARGET [--max-hops N] [--max-visited N] [--max-results N]`

Selector 與 M4/M5 相同：exact ID優先，否則唯一exact label；空字串／空白拒絕。bounds 與 MCP 一致：hops32（1～100）、visited10000（1～100000），impact results100（1～1000）。不合法選項在建圖／建立cache前拒絕。
每次命令獨立開啟／重用當前有效index，使用 LiveWorkspace.execute 在讀取前後核對source/context/runtime/graph；來源在命令之間改變時下次命令會重新建立index，命令內發生變動則拒絕結果。不自動重試，不執行來源。
stdout 成功時只有一份 JSON：`status: ok`、`index`、`result`，index 包含與 MCP 同樣的 index_id/source_commit/source_fingerprint/context_sha256/graph_sha256；result 沿用 calls_path/change_impact。
錯誤時 stdout 為空，stderr為診斷，exit2；不輸出舊正文或失敗callback中的舊診斷。argparse語法錯誤亦exit2。

| exit | 意義 |
| --- | --- |
| 0 | calls-path found，或 impact complete（可含空callers）。 |
| 4 | calls-path not_found；stdout仍有完整JSON負例。 |
| 5 | 任一工具 limit_reached；stdout仍有JSON及原因／已找到的部分結果。 |
| 2 | 參數、selector、來源、cache、freshness或讀取失敗；stdout無結果。 |

呼叫方向、靜態圖完整性、Python hint啟發與上限的既有限制不變。每次CLI仍有建圖／驗證成本，沒有常駐效能保證；stdout JSON可含來源metadata，發布前仍需檢視。
原query/explain/locate/source/serve/serve-live命令契約保持不變；無新dependency、全域設定、watcher、自動刷新、release/deploy。

## 固定驗收

| AC | Given / When / Then |
| --- | --- |
| C-01 | 真Graphify source與MCP共用cache；calls-path/impact真CLI結果包含可核對nodes/edges/source與provenance，與MCP dispatch同一snapshot一致。 |
| C-02 | 正向／反向無路徑、三種搜尋上限、無caller、同名／exact ID／未知及非法參數；exit0/4/5/2與stdout/stderr契約正確，非法參數不建cache。 |
| C-03 | 兩次命令之間rename時新index與結果正確、舊graph仍保留；命令中source/context/graph改變（含callback成功或拋錯）拒絕結果與舊診斷；損壞cache拒絕。 |
| C-04 | 原92tests、新真CLI及邊界回歸、原7場景/M2pilot/M3trial、repo gates、獨立審查、必要CI與PR合併／遠端回讀、帳本紀錄完成。 |

## 執行計畫

Base e00866434e856d164a59516bc9c7de2f4770020b；Graphify0.9.97、Python3.12與既有lock。
開始2026-10-30T10:08:35Z，估計35–60主動分鐘含一位有界獨立reviewer，每20分鐘checkpoint；每問題最多兩次有理由修正、每head CI15分鐘等待上限。
完整工具/provider requests/tokens/cost沒有可靠量測則null。最終進度及交付證據由[任務板](../tasks/BOARD.md)引用。
