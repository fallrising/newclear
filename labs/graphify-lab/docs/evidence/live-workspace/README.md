# T-0441 M4 本機驗證

新增 opt-in `serve-live`，提供狀態、明確刷新、真Graphify查詢、有界來源回讀與有向calls-only路徑。
原 `serve` 保持固定快照。最終 CI／合併回讀以[任務板](../../tasks/BOARD.md)為準。
本機基準 `1a00b899f855dffc7e23cc3a85a257cb157b0556` 加本PR未提交整合內容；Graphify0.9.97／Python3.12／既有hash lock。

| AC | 證據 |
| --- | --- |
| L-01 | `test_live_state`：來源/context/runtime變動、刪除、graph損壞/symlink、成功或失敗callback期間變動均拒絕。status不建索引。 |
| L-02 | `test_live_state`：暖刷新重用、rename切換、候選驗證失敗保留舊pointer、修復恢復、讀取/刷新序列化。 |
| L-03 | `test_call_paths`：真Graphify提取的三層鏈、反向/無關/contains-only負例、歧義、cycle與界限；四項補充小圖僅驗算法邊界。 |
| L-04 | `test_live_mcp`：真stdio同一session完成查詢→修改→過期拒絕→刷新→新結果，空來源刷新失敗→修復恢復；含invalid bounds/traversal。 |
| L-05 本機 | [81tests](final-tests.txt)、[原場景/M2/M3摘要](regressions.json)、repo gates與獨立審查。遠端交付由任務板記錄。 |

## 實際命令

Lab cwd：
- `make check`：最終81tests，34.981秒，exit0；包含13state／11paths／1真MCP加原56。
- `make full RUN_DIR=work/m4-full`：7passed/0failed，exit0。
- `.venv/bin/python -m graphify_lab.pilot --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 --out work/m4-pilot`：passed。
- `make workspace-trial RUN_DIR=work/m4-workspace`：passed；原snapshot入口仍能完成真元件／MCP驗證。
Repo cwd：`python3 scripts/check_indexes.py`（47contracts/8llms/0errors）、`ACTIONLINT_CACHE_DIR=/tmp/graphify-t0437-actionlint python3 .github/scripts/check_workflows.py`（40workflows）、`git diff --cached --check`均通過。

原7場景/M2/M3試跑早於最後live_state失敗callback修正，摘要保留原報告digest與input hashes；它們不使用新live_state。最終81tests已覆蓋修正；CI再驗實際提交版本。沒有把早期79tests當成最終結果。
23個明確MCP requests包括initialize/list，實際工具操作見測試末行；通知未計入。這不是agent/provider用量；provider requests/tokens/cost及完整編排總數未知為null。

## 失敗與修正

- [MCP RED](mcp-red.txt)：新入口未存在，真client connectionclosed；worker各先見缺module的RED後GREEN。
- [SDK欄位失敗](mcp-sdk-failure.txt)：既有MCP2使用snake_case Python欄位，修正input_schema/is_error後[真流程通過](mcp-green.txt)。沒有改依賴。
- 初次FastMCP/decorator探查遇MCP2移除API，改用已安裝SDK低階callbacks；parent測試曾從錯誤cwd執行而import失敗，pathworker初次路徑錯誤0tests；均屬準備失敗、不算產品成功。
- 獨立審查發現callback拋例外時漏做最後freshness檢查，可能帶出舊查詢診斷。先增加兩項回歸重現，再修正：任何callback完成/拋例外都驗證，過期時捨棄舊exception正文/cause/context；current時保留原exception。獨立重現複查已確認修復。

## 判讀

來源與graph為真；程式不執行被索引來源、不付費API、不改全域client、不新增依賴。
驗證只能描述觀測時點，無檔案鎖對抗外部編輯器、watcher、自動刷新或跨client通知。每次讀取檢查來源有成本，query仍有CLI子程序成本。
calls-only是靜態圖導航，不保證完整執行語義；limit_reached表示搜尋未完成，不能冒稱無路徑。測試不代表大型repo效能或token節省。
