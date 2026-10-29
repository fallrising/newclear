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
