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

## 開發中的 MCP：明確刷新

需要持續編輯來源時，改用 `serve-live`；原 `serve` 的快照契約保持不變。

```sh
.venv/bin/python -m graphify_lab.workspace --source ../../tools/codex-usage serve-live
```

Client 的 command/cwd 與前節相同，最後一個 args 改為 `serve-live`。此入口只提供以下五個工具，不代理其他上游工具：

| 工具 | 輸入與用途 |
| --- | --- |
| `workspace_status` | 無參數；回傳 current/stale/error、index_id 與來源／索引 provenance，不建圖。 |
| `refresh_workspace` | 無參數；明確重用或建立索引，驗證成功才切換；失敗保留舊 pointer。 |
| `query_graph` | question、可選 budget（1～32000，預設1000）、context；呼叫真 Graphify CLI。 |
| `source_excerpt` | exact label、可選 file、lines（1～100，預設20）；回讀有界來源。 |
| `calls_path` | source/target 為exact ID或唯一exact label；只沿有向 calls 邊查詢。 |

先查 `workspace_status`；來源或設定變動後，讀取工具會以 MCP `isError` 回覆並省略查詢正文，須呼叫 `refresh_workspace`。
刷新失敗不能視為成功：查狀態，修復原因，再明確刷新。新結果帶 index_id、source fingerprint、context／graph digest；舊圖仍留在cache。
來源、ancestor設定、runtime identity及graph digest都會驗證；讀取前後有變化就丟棄結果。同一server序列化刷新與讀取。
這是操作時的檢查，無背景watcher或自動刷新，不能鎖住外部編輯器；回覆代表驗證時點，不承諾之後檔案不變。
每次檢查需讀來源，較大目錄有額外成本；查詢仍用子程序，未宣稱常駐引擎加速。

`calls_path` 回傳 found、not_found 或 limit_reached；搜尋上限不代表不存在路徑。
預設 max_hops=32、max_visited=10000，上限分別100與100000；visited包含起點，同節點0-hop有效。
路徑保留節點的source指標與原calls邊，方向為source→target；同名必須改用ID，contains不參與。
靜態calls仍不代表完整執行語義。更多結果與驗收見[M4規格](milestones/live-workspace.md)。

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
