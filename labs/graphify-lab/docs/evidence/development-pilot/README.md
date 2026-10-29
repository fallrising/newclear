# T-0437 開發任務試點結果

本次完成真實 `graphify_lab` 維護：將 `node_at`／`source_excerpt` 從 CLI 抽到 `source.py`，舊 import 仍相容。
實作由主導 source review 與測試先行完成；graph 調查是同一任務在固定修改前來源上的回放，沒有宣稱 agent 先看 graph 才寫出修正或做過盲測。

## 正確性與量測

[pilot.json](pilot.json) 對應 baseline `c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7` 的七份真實 Python 檔，逐檔 Git blob／SHA256 在報告。
真 Graphify 0.9.97 產生 159 nodes／470 edges；兩個 helper 與三個 caller/test 定義均由來源 AST／行號核對。
10 個直接呼叫位置都找到對應 calls 邊；同 caller 多個 call site 共用一條圖邊，實際為 6 組唯一 caller→helper 關係，也不代表所有動態依賴完整。
MCP 真 stdio 完成 initialize、列舉及四次工具請求；baseline 程式沒有被 import 或執行。

| 觀測 | 本次結果 |
| --- | --- |
| 建圖 | 1.724 秒 |
| 兩次 CLI helper query | 228.267／224.293 ms |
| 兩次 rg exact lookup | 4.918／4.866 ms |
| 兩次常駐 MCP query | 5.197／5.093 ms |
| 完整 pilot 程序 | 4.801 秒 |
| 明確記錄操作 | 10 CLI 子命令、9 Git read commands、6 MCP protocol requests |
| agent／provider／tokens／費用 | 未有完整計量，null；不由 bytes、操作數或程序時間推算 |

這是單次已知任務回放，CLI／rg／MCP 輸出與啟動成本不同；沒有比較兩個 agent 的解題速度。
簡單定義搜尋仍適合 rg；圖能提供已核對的關係與來源指標。這些數據不支持通用速度或 token 節省結論。

## 回歸與失敗保留

- [source-red.txt](source-red.txt)：新增共用模組契約先因模組不存在失敗；抽取後四個 source tests 通過，涵蓋舊 import、Unicode／行範圍、歧義、symlink 越界與界限。
- [source-green.txt](source-green.txt)：抽取後 33 tests 通過。整合 pilot 的完整測試另存 integrated-tests.txt。
- [full-run.json](full-run.json)：抽取後原七組真 CLI／MCP 場景 7 passed／0 failed。當時尚未加入 pilot.py；原場景相關 source／lock／fixture hashes 可核對，不冒稱覆蓋新 runner。
- [pilot-sandbox-failure.json](pilot-sandbox-failure.json)：首次普通沙箱 MCP 初始化失敗，其他 graph/source 查核成功。以允許 stdio 子程序的執行環境重試，未修改上游或用 mock，得到 pilot.json。
- 安裝初次因沙箱 DNS 失敗；核准環境重試相同 hash lock 成功。Workflow gate 初次命令路徑錯誤、其後缺外部 cache；正確入口配置後 40 workflows 通過。這些不是產品測試失敗。

## 可重跑與後續

入口：[agent 工作流程](../../agent-workflow.md)。CI 會 fetch 明確 baseline，跑完整測試、原場景與新 pilot。
本次沒有改全域 MCP 設定、部署、發布 tag 或呼叫模型 API。

建議先在需要追多層關係的較大真實任務上使用，再決定擴充；若要證明效益，另設同等任務的盲測與可靠 provider usage 採集。
瀏覽器互動、離線 viewer、多機共享與更多語言仍未驗，本次不自動啟動第三階段。

## 審查與交付

獨立審查及最終 CI／PR 連結由任務板與 PR 記錄；未合併前 T-0437 保持 in_progress。

提交前 staged whitespace gate 移除 `source.py` 的一個 EOF 空白行。原 full-run 保存的 source.py SHA256 對應多一個尾端 newline 的內容；已用 current bytes＋newline 重算吻合，函式 AST 未變。最終 head 的 CI 會驗證實際提交 bytes。
