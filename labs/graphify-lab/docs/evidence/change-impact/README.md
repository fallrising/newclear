# T-0443 M5 驗證與限制

`serve-live` 新增 `change_impact`：沿真 Graphify calls 圖反向列出 caller，保留正向路徑、來源與 Python 命名測試線索；freshness 與明確刷新沿用 M4。
基準 `6b7bf17c010f6a354f7abf3676f994f7ae2d19ec` 加本 PR 修改；Graphify0.9.97、Python3.12.3、既有 hash lock。
最終 CI／合併與技術任務狀態見[任務板](../../tasks/BOARD.md)。

| AC | 行為與證據 |
| --- | --- |
| I-01 | 真解析 `test_change_impact.RealChangeImpact`：直接／間接 callers、原 calls edges、source 行號讀回、未知／同名拒絕、exact ID。 |
| I-02 | 同測試的可達／無關測試負例，另以小圖驗 Python name/path 交集、其他語言／誤導名稱排除；每 hint 帶規則原因，回應明列限制。 |
| I-03 | 真三節點環與三種界限；小圖補充穩定 diamond／parallel edges、輸入不變、ID 優先、非法圖與參數；補充小圖不冒充 parser 成功。 |
| I-04 | `test_change_impact_mcp.ChangeImpactMCP.test_I04_impact_edit_refresh_and_source`：真 stdio 列工具、query/source 來源與 index 相符、參數負例、修改拒絕、刷新新 caller/hint、刷新失敗拒絕。 |
| I-05 本機 | [92tests](tests.txt)、[原七場景/M2/M3](regressions.json)、索引/workflow gates、獨立審查；遠端 gates 另見任務板。 |

## 命令與觀察

Lab cwd：
- `make check`：92 tests passed，36.428s；原81加新11。執行在允許 stdio 子程序通訊的環境，外層 timeout240。
- `.venv/bin/python -m unittest discover -s tests -p test_change_impact.py -v`：10 tests passed，涵蓋真提取及補充算法；先保留[缺模組RED](red.txt)。
- `.venv/bin/python -m unittest discover -s tests -p test_change_impact_mcp.py -v`：1 passed，2.232s；[真MCP結果](mcp-green.txt)。15 requests 含 initialize/list，不含通知，非 provider 請求或生產力統計。
- `make full RUN_DIR=work/m5-full-stable`：7 passed/0 failed。
- `.venv/bin/python -m graphify_lab.pilot --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 --out work/m5-pilot`：passed。
- `make workspace-trial RUN_DIR=work/m5-workspace`：passed。

Repo cwd：`python3 scripts/check_indexes.py`：47 contracts、8 llms、0 errors；`ACTIONLINT_CACHE_DIR=<scratch> python3 .github/scripts/check_workflows.py`：40 workflows pass。`git diff --cached --check` 最終通過。
92tests 後只有 call_graph.py EOF 空行移除，無 runtime 語義改變；stable full 已記錄當前 input hashes，獨立 focused tests 在移除後通過，CI 再驗提交版本。

## 失敗與修正

- setup 初次沙箱 DNS 無法連線；允許網路後沿用相同 requirements.lock 安裝成功，無新依賴。
- 本機 MCP 初次沙箱 initialize timeout（62.153s）；改為允許通訊環境、timeout90 後，[真缺工具RED](mcp-red.txt) 在2.383s觀察到未列舉 change_impact，再接入實作後通過。
- [最初兩節點環測試失敗](initial-cycle-failure.txt)：source 的 cycle_a→cycle_b 與 cycle_b→cycle_a，實際圖只存前者。保留這項上游限制；改用真三節點環驗證 cycle 終止，不補造遺失邊或修改上游。
- 初次 staged whitespace gate：新增 call_graph.py EOF 多空行，修正後通過；首輪 full 的7項產品場景通過，但同時修改該空行觸發 INPUT-INTEGRITY 失敗。保留摘要及 raw digest，以新的 stable run 通過後才接受；不是忽略輸入變更或改驗收門檻。
- 發布準備曾在沙箱呼叫 git write-tree 因 Git metadata 唯讀失敗，尚未建立遠端物件；改用已驗證的 staged tree SHA。無 commit／push 越過失敗 gate。
- 獨立審查指出 README 仍寫五工具，已修正為六；runtime 無未解 must-fix。

## 解讀與投入

只回傳圖內 calls 可達項，`complete` 不代表完整執行語意。測試 hints 限 Python 公開命名規則，可能漏列或誤判框架收集，不能取代實際測試發現與驗證。未知或動態呼叫不猜測；contains 不算證據。
max_hops/visited/results 限遍歷與輸出，圖仍整份讀取與驗證。freshness 僅代表觀測時點；不鎖外部編輯器、無 watcher 或自動刷新。
沒有執行被索引來源、全域設定、新runtime依賴、付費API、release/deploy。未宣稱 token 節省。
本輪一個 native 獨立 reviewer（實際啟動）；完整外層/巢狀工具次數、provider requests/tokens/cost 無量測來源，均 unknown/null。開始03:55:13Z，事前估計45–75主動分鐘、20分鐘checkpoint；詳細交付時間與等待口徑由 journal 記錄。

[獨立審查 ACCEPT](../../../../../.team/graphify-t0443/review.md)：11 focused tests（2.562s）及13,824個三節點有向圖／界限組合通過；無未解 must-fix。補充組合只證明算法，不證明 parser 完整性。
