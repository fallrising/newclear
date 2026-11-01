# T-0446 M7 節點來源與索引版本確認

CLI `source-node` 與 live MCP `source_node` 共用 exact ID reader，提供有界來源與原節點，以及可選 expected_index_id。舊 label reader保持相容。
Base276df71a3e874b142efc53b11f9c98d009d668c4加本PR；Graphify0.9.97／Python3.12.3／既有hash lock。最終交付由[任務板](../../tasks/BOARD.md)記錄。

| AC | 證據 |
| --- | --- |
| N-01 | test_N01_same_file_same_label_uses_exact_id_and_provenance：真Graphify抽取同檔案Alpha.run/Beta.run，相同label、不同ID與L2/L6；真CLI及MCP dispatch同provenance、位置與有界內容；舊label+file仍拒絕。 |
| N-02 | test_N02_*：唯一ID、無label fallback、unknown/duplicate、lines/hash型別格式及bounds、expected mismatch、非法來源位置與symlink逃逸；無來源正文。僅adversarial metadata使用合成graph，作拒絕測試而非解析成功證據。 |
| N-03 | test_N03_*：CLI跨命令改內容後舊index拒絕；source/context/graph × callback成功/失敗共6組真檔案競態不洩漏正文／舊診斷。真stdio15requests（含initialize/list）走path→ID來源→edit stale→refresh→舊hash拒絕→新hash更新內容。 |
| N-04 | focused/full tests、原7場景/M2pilot/M3trial、repo原生gates、獨立審查；遠端CI/合併/回讀由任務板記錄。 |

## 命令與失敗紀錄

- `.venv/bin/python -m unittest discover -s tests -p test_node_source.py -v`：實作前缺少source_node import的預期RED，exit1，[原失敗](red.txt)。
- `timeout 120 .venv/bin/python -m unittest discover -s tests -p 'test_node_source*.py' -v`：9passed/12.081s，[focused](focused.txt)。
- 首次新MCP旅程誤取calls_path既有欄位nodes（實際為path），KeyError；只修正測試欄位，未改既有產品契約。[失敗證據](test-fixture-failure.txt)。當時已載入舊測試的全套109tests也以同一錯誤失敗，原命令鏈因此未進入後續場景；最後重新跑完整gate。
- `python3 scripts/check_indexes.py` 首次因新規格尚未git add而報llms連結不存在；依checker從Git index列路徑的契約stage新文件後，47contracts／8llms／0errors。
- `ACTIONLINT_CACHE_DIR=<scratch> python3 .github/scripts/check_workflows.py`：40workflows／actionlint1.7.12通過；workflow未修改。

## 限制與投入

expected_index_id比對當前有效快照，不載入歷史圖；ID不保證跨版本語意身份。CLI可先建目前索引才得知有效hash不符；語法非法的選項才保證cache前拒絕。
來源由圖指標定位、以現有canonical path/line界限讀回；靜態圖不代表完整執行語意。前後freshness只代表觀測時點，不鎖外部編輯器，不提供watcher或自動刷新。
沒有來源執行、新dependency/parser/算法、全域設定、release/deploy或token節省主張。
重用一位native獨立reviewer（followup assignment），無新spawn或實作workers。完整外層/巢狀工具數、provider requests/tokens/cost與精確主動/等待秒數未知為null；測試MCP15requests不是provider呼叫。

## 最終本機驗證

Lab cwd：`timeout 300 make check`，109tests/60.467s通過（原100+新9），[tests](tests.txt)。
`timeout 300 make full RUN_DIR=work/m7-full`：7passed/0failed。
`timeout 180 .venv/bin/python -m graphify_lab.pilot --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 --out work/m7-pilot`：passed。
`timeout 180 make workspace-trial RUN_DIR=work/m7-workspace`：passed。
[精簡結果、原始報告digest與inputhash](regressions.json)。測試後沒有runtime/tests變更。
獨立focused9tests/12.036s及真MCP15requests通過；[審查報告](../../../../../.team/graphify-t0446/review.md)記錄最終判斷。
