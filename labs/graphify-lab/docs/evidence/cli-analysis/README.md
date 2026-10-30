# T-0444 M6 命令列分析驗證

新增 workspace `calls-path` 與 `impact`，重用既有有界圖分析及 LiveWorkspace 前後驗證；原 MCP／CLI 契約不變。
來源base `e00866434e856d164a59516bc9c7de2f4770020b` 加本PR內容，Graphify0.9.97／Python3.12.3／原hash lock。
最終CI、合併及回讀以[任務板](../../tasks/BOARD.md)為準。

| AC | 可核對證據 |
| --- | --- |
| C-01 | `test_C01_real_cli_matches_mcp_readers_and_provenance`：真CLI子程序、真graph與同snapshot MCP dispatch一致；source L1、callers與hint、五項provenance完整。MCP dispatch非新stdio測試，原M4/M5真stdio仍由full tests覆蓋。 |
| C-02 | `test_C02_*`：found/complete/no path/三種上限及0/4/5/2；JSON stdout及stderr契約、同名/ID/未知、13組非法請求與help不建立cache。 |
| C-03 | `test_C03_*`：rename後換index並保留舊graph、損壞cache拒絕；兩命令×source/context/graph×callback成功/失敗共12組race均不輸出舊正文或舊診斷。race hooks仍呼叫真算法、修改真檔案，未mock parser/graph為成功。 |
| C-04 本機 | [100tests](tests.txt)、[原7場景/M2/M3摘要及digest](regressions.json)、repo gates與獨立審查；遠端交付以任務板為準。 |

## 實跑命令

Lab cwd：
- `.venv/bin/python -m unittest discover -s tests -p test_workspace_analysis.py -k test_C01 -v`：實作前RED，兩子案例被argparse以未知子命令拒絕，exit1。[原失敗](red.txt)。
- `timeout 120 .venv/bin/python -m unittest discover -s tests -p test_workspace_analysis.py -v`：8 tests passed／12.597s，[focused](focused.txt)。
- `timeout 300 make check`：100 tests passed／55.061s（原92+新8），含M4/M5真stdio。使用已證實能正常stdio的環境。
- `timeout 300 make full RUN_DIR=work/m6-full`：7passed/0failed。
- `timeout 180 .venv/bin/python -m graphify_lab.pilot --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 --out work/m6-pilot`：passed。
- `timeout 180 make workspace-trial RUN_DIR=work/m6-workspace`：passed。

Repo cwd：`python3 scripts/check_indexes.py`，47contracts/8llms/0errors；`ACTIONLINT_CACHE_DIR=<scratch> python3 .github/scripts/check_workflows.py`，40workflows/actionlint1.7.12；`git diff --cached --check`通過。
測試完成後沒有runtime/tests變更；本輪runtime沒有未知子命令RED以外的失敗或重試。最終staged gate在原RED輸出首行發現尾端空白，已僅移除證據行尾空白後重驗，原失敗語意保留。setup沿用已知網路權限與既有lock，無新依賴。

## 限制與成本

stdout頂層status=ok不是完整性保證，腳本須處理result.status及exit4/5；exit5保留JSON部分結果，搭配set-e時須明確處理。
complete僅表示圖中可達caller全走完；上游可遺漏邊，Python hints只是命名推論而非完整測試選擇。現有算法／上限／hint語言沒有擴張。
每個命令仍需讀取來源、驗證cache並可能建圖；freshness只代表檢查時點，無watcher、檔案鎖或自動重試。沒有來源執行、全域設定、付費API、release/deploy或token節省主張。
本輪重用一位native獨立reviewer（followup assignment，無新spawn、無實作workers）；完整外層/巢狀工具數、provider requests/tokens/cost未知為null。計時由journal記錄，未把測試數或worker預算當provider實耗。

[獨立審查 ACCEPT](../../../../../.team/graphify-t0444/review.md)：獨立8tests/16.719s及全部本機gate證據已核對；無未解must-fix，遠端交付仍由任務板追蹤。
