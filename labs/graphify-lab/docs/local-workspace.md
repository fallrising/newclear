# 本機工作目錄

除了固定公開 reference，現在可以對明確指定的本機元件直接建圖。
先依 [README](../README.md) 執行 `make setup PYTHON=python3.12`；不需要先 `prepare` 或改 manifest。
以下從 `labs/graphify-lab` 執行，cache 必須在來源外：

```sh
.venv/bin/python -m graphify_lab.workspace --source ../../tools/codex-usage locate
.venv/bin/python -m graphify_lab.workspace --source ../../tools/codex-usage query normalize_rates --context call --budget 3000
.venv/bin/python -m graphify_lab.workspace --source ../../tools/codex-usage source 'normalize_rates()' --file codex_usage.py --lines 12
```

`locate` 回傳 graph 路徑、內容 fingerprint、Git HEAD provenance、index ID 與 cache_hit。
Git HEAD 不等於工作目錄 bytes；未提交修改由 fingerprint 辨識。不同 consumer 指定同一 source/cache 即共用索引。
`explain` 接 graph node ID；`source` 同名符號必須用 `--file` 限定，讀取上限 100 行。
非法參數在建圖前拒絕。來源／設定變更在下一個命令重新辨識；舊 graph 留存，損壞的 cache 明確失敗。

## MCP

```sh
.venv/bin/python -m graphify_lab.workspace --source ../../tools/codex-usage serve
```

MCP client 的 command 用此 `.venv/bin/python` 絕對路徑，cwd 設為本 lab，args 使用上述 `-m ... --source <absolute-directory> serve`。
共用 cache 可加 `--cache <absolute-directory>`；命令列參數放在 operation 前。
這是 stdio server；沒有 HTTP port，也不會安裝全域 client 設定。

**MCP 固定啟動時的圖快照。來源改動後要結束並重開 server。** 短命令每次重驗，長連線沒有 watcher 或熱更新；
不可把舊 session 的行號視為最新來源。精確 source 命令在讀回後再次核對內容與 context，有變動就拒絕輸出。

## 命令列呼叫路徑與修改影響

不啟動 MCP 也能使用同一套 calls-only 分析：

```sh
.venv/bin/python -m graphify_lab.workspace --source ./your-project calls-path 'entry()' 'leaf()'
.venv/bin/python -m graphify_lab.workspace --source ./your-project impact 'leaf()' --max-results 50
```

將 `./your-project` 換成明確來源目錄；函式標籤含括號時須加引號。也可使用 exact node ID 解開同名歧義。
兩者在 stdout 輸出一份 JSON，含 `status: ok`、`index` provenance 與 `result`；內容及搜尋上限與下文對應 MCP 工具相同。
`calls-path` 接受 max-hops/max-visited；`impact` 另接受 max-results（CLI 使用連字號選項，JSON 欄位仍為底線）。

退出碼0表示 found/complete（impact可沒有caller）；4表示確定圖內沒有呼叫路徑；5表示搜尋上限，仍輸出帶原因的JSON及可用部分結果。
`status: ok` 只表示查詢成功執行，腳本還須讀 `result.status`，不能將exit5當成沒有影響。
參數／未知或歧義selector／cache／freshness錯誤為exit2，stdout為空，stderr提供診斷。
在shell使用`set -e`時，須明確處理預期的4/5退出碼才能繼續處理JSON。

每次命令開啟當前索引：命令之間編輯來源，下次會重新建立或驗證；命令執行中編輯則拒絕輸出，不自動重試。
來源與graph在讀取前後驗證，仍是觀測時點保證，無watcher或檔案鎖。原`query`/`explain`退出碼契約不變。
靜態calls可能遺漏關係，Python命名測試hints不是完整測試選擇器。詳見[M6契約](milestones/cli-analysis.md)。

## 開發中的 MCP：明確刷新

需要持續編輯來源時，改用 `serve-live`；原 `serve` 的快照契約保持不變。

```sh
.venv/bin/python -m graphify_lab.workspace --source ../../tools/codex-usage serve-live
```

Client 的 command/cwd 與前節相同，最後一個 args 改為 `serve-live`。此入口只提供以下六個工具，不代理其他上游工具：

| 工具 | 輸入與用途 |
| --- | --- |
| `workspace_status` | 無參數；回傳 current/stale/error、index_id 與來源／索引 provenance，不建圖。 |
| `refresh_workspace` | 無參數；明確重用或建立索引，驗證成功才切換；失敗保留舊 pointer。 |
| `query_graph` | question、可選 budget（1～32000，預設1000）、context；呼叫真 Graphify CLI。 |
| `source_excerpt` | exact label、可選 file、lines（1～100，預設20）；回讀有界來源。 |
| `calls_path` | source/target 為exact ID或唯一exact label；只沿有向 calls 邊查詢。 |
| `change_impact` | target 為exact ID或唯一exact label；反向尋找 caller，回傳來源、正向 calls 證據與 Python 測試線索。 |

先查 `workspace_status`；來源或設定變動後，讀取工具會以 MCP `isError` 回覆並省略查詢正文，須呼叫 `refresh_workspace`。
刷新失敗不能視為成功：查狀態，修復原因，再明確刷新。新結果帶 index_id、source fingerprint、context／graph digest；舊圖仍留在cache。
來源、ancestor設定、runtime identity及graph digest都會驗證；讀取前後有變化就丟棄結果。同一server序列化刷新與讀取。
這是操作時的檢查，無背景watcher或自動刷新，不能鎖住外部編輯器；回覆代表驗證時點，不承諾之後檔案不變。
每次檢查需讀來源，較大目錄有額外成本；查詢仍用子程序，未宣稱常駐引擎加速。

`calls_path` 回傳 found、not_found 或 limit_reached；搜尋上限不代表不存在路徑。
預設 max_hops=32、max_visited=10000，上限分別100與100000；visited包含起點，同節點0-hop有效。
路徑保留節點的source指標與原calls邊，方向為source→target；同名必須改用ID，contains不參與。
靜態calls仍不代表完整執行語義。更多結果與驗收見[M4規格](milestones/live-workspace.md)。

## 修改影響與測試線索

對 `change_impact` 傳入 `{"target":"leaf()"}`，可用 query 結果中的 exact ID 解開同名歧義。
結果的 `callers` 每筆有原 `node`（source_file/source_location）、`hops`、`direct`、`path` 與 `edges`。
遍歷方向是反向找 caller；證據 path/edges 仍依 caller→target 排列，contains 不參與。
`test_hints` 引用 caller ID，僅當 Python `test_` 符號位於 test/tests 目錄或 test_*.py/*_test.py 時提供命名理由；這不是實際測試發現或完整測試選擇器。
可以再用 `source_excerpt` 讀回 caller 的來源與行號，核對測試是否適用。

可選 max_hops=32（1～100）、max_visited=10000（1～100000，含target）、max_results=100（1～1000，不含target）。
`complete` 僅表示走完圖中可達的 calls；`limit_reached` 和 `reasons` 表示仍有 caller 未搜尋，已找到的結果仍可核對。
空 callers/test_hints 不代表沒有執行時影響或不需測試；圖可能遺漏邊，實測雙向互呼只保留一個方向。
不支援其他語言的測試命名推論，不執行被索引程式；界限不限制整圖讀取與驗證成本。
本工具沿用前後 freshness 檢查、成功 provenance 與明確刷新流程；詳見 [M5 規格](milestones/change-impact.md)。

## 選擇來源與資料位置

只索引你明確指定的目錄，唯讀處理來源，不執行其程式。cache 放在來源外，預設沿用 `GRAPHIFY_LAB_CACHE`／XDG 共用位置。
選擇元件根目錄，避免整個 home 或含大量 dependencies／build outputs 的目錄：fingerprint 會讀來源下全部一般檔（除 Git metadata），
即使解析器會忽略部分檔案，驗證仍有成本。directory symlink 不支援；JS/TS 依賴來源外 resolver 設定時沿用既有拒絕規則。
本機 JSON 含路徑，若要公開報告須先遮罩；graph 是導航索引，不能取代 source 或完整測試選擇器。

Graphify 原生 `shortest_path` 可能經過 `contains` 等關係；要判斷函式呼叫鏈，須另核對有向 `calls` 邊與來源。
不能只因最短路徑包含兩個符號就宣稱它是呼叫路徑。

## 可重跑驗證

```sh
make workspace-trial RUN_DIR=work/workspace-first-run
```

試跑真實 `tools/codex-usage` 的三層函式鏈、共享索引與 MCP；只在暫存來源副本驗 rename／索引失效，不修改或執行該元件。
RUN_DIR 必須是新目錄。結果為 `report.json`，保留正誤檢查、來源 fingerprint、時間與未知 provider 用量；不宣稱通用速度／token 節省。
[本輪 AC](milestones/local-workspace.md)；最新結果由任務板連到對應證據。
