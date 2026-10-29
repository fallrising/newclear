# T-0439 本機工作目錄驗證

W-01～W-04 的實作與本機驗證通過；W-05 的 CI／合併結果由任務板補記。
來源基準為 newclear `2c73caf464bec1281f037aca3f2281aae60b0362`，在未提交的整合 worktree 執行。
Graphify 0.9.97／Python 3.12；未改 lock 或 tools/codex-usage 原始碼。

## 證據對照

| AC | 可核對結果 | 證據 |
| --- | --- | --- |
| W-01 | 冷建圖、暖重用、兩 consumer 同一實體索引，缺目錄／非法 cache 拒絕 | [56 tests](unit-tests.txt)、[trial](trial.json) consumers/shared_index_verified |
| W-02 | 真 query/explain/source、同名／無命中 exit3/4、參數先驗證、來源越界與讀取競態拒絕 | workspace tests；trial definitions/commands |
| W-03 | rename 產生新索引、舊符號消失、舊 graph 不變；ancestor ignore 失效 | workspace tests；trial mutation |
| W-04 | 三層 helper 呼叫、AST 定義／callsite、真 stdio initialize/list/query/paths | trial directed_calls/definitions/mcp |
| W-05 本機部分 | 原39＋新17 tests、原7場景、M2 replay、index/workflow gates | unit-tests、[原場景](full-regression.json)、[M2](pilot-regression.json)；獨立 review 另記 |

真實 tools/codex-usage：29 files／204,000 bytes，222 nodes／550 edges。
內容 fingerprint `91bf5bca1c85a10b22047bd54c6a788ba3c1ea0e696019ed4e1af82ad08d37b3`，執行前後相同。
`normalize_rates`（282行）→ `norm_window`（268行）→ `remaining_percent`（56行），calls 位置為322與275行。
Parent 的 `make workspace-trial RUN_DIR=work/t0439-workspace` 通過，13 CLI commands／6 MCP requests，程序8.655174秒；這只涵蓋此試跑，不是 agent／provider 計量。
完整模型請求、tokens、成本及跨 compaction 編排總數無可靠來源，均為 null；不宣稱效能／token 節省。

## 驗證命令與限制

- `make check`：56 tests，38.460秒，exit0。
- `make full RUN_DIR=work/t0439-full CACHE="$PWD/work/shared-cache"`：7 passed／0 failed，exit0。
- `.venv/bin/python -m graphify_lab.pilot --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 --out work/t0439-pilot`：passed，exit0。
- `make workspace-trial RUN_DIR=work/t0439-workspace`：passed，exit0。
- Repo root `python3 scripts/check_indexes.py`：47 contracts／8 llms files／0 errors。
- Repo root `ACTIONLINT_CACHE_DIR=/tmp/graphify-t0437-actionlint python3 .github/scripts/check_workflows.py`：40 workflows，pass。

[歷史失敗](historical-failures.json) 保留 sandbox stdio initialize timeout，以及第一次 native 試跑把整段 shortest_path 當作 calls-only 的錯誤預期。
真正上游最短路徑可能經由檔案 contains 邊；成功報告保留該結果，並用每一段 MCP shortest_path、圖中有向 calls 邊及 AST 分別驗證呼叫鏈。沒有更換上游或 mock，也沒有宣稱最短路徑會過濾邊類型。
`serve` 是啟動時固定的 snapshot，改來源後要重啟；來源 fingerprint 會讀所有一般檔，應選元件根目錄。
本試跑是已知元件／路徑，沒有執行該元件，不代表完整動態語義、盲測、更多語言或任意 repo 的正確率。

試跑原始報告為 ignored work 產物，公開 JSON 是可審查摘要：CLI stdout/stderr 改存 digest／bytes，工具 schema 改為名稱，其餘關鍵來源／關係／MCP 結果保留；每份摘要附原報告 SHA256。CI 每次保存完整報告7天。
本輪兩個實作 worker 各先見缺 module 的 RED，再完成12與5項 GREEN；parent 路徑錯誤造成的0 tests/exit5 不算 RED 或成功。完整整合測試是上述56項，沒有省略。
