# M3：cc-quota 封存與 Agent Usage 歷史查詢

Owner 於 2026-10-23 要求封存另一項目並繼續開發。本地封存／歷史切片已完成並通過獨立複驗；
整體 Agent Usage 主線仍 incomplete，不代表所有 provider 自動 quota、真人驗收或 hosted CI 已完成。

## 封存決策

cc-quota 原地標記 archived／not-applicable／Tier D，撤下活動入口，舊啟動 prompt 明示失效。
後續開發集中 Agent Usage；原 README 完整保存在 legacy-overview，原 AC-01–04 及已合併證據保留，
pending Mac真人驗收沒有改成 passed。保留舊程式、安裝器與測試路徑，沒有刪資料、搬設定或操作既有排程。
[六個封存檔案 hashes](2026-10-23-cc-quota-archive-hashes.json) 已複驗不變。
舊排程／通知屬封存版本，不宣稱已遷移成新工具受維護功能；相容 CI 保留不等於重新開發。

## 新功能

`agent_usage.py history --config FILE --hours 24 --limit 100 --format table`

只讀已設定 Claude claude-db，時間範圍從現在回推，最新最多500列再依時間升序顯示。
JSON/table 明示歷史百分比、UTC時間、各窗口缺漏、截斷及錯誤；不將歷史數字當目前剩餘，
不加總重疊窗口，不讀 raw／error.message／credentials，不建立或遷移 DB。
其他來源無歷史儲存 adapter；未設定或 unsupported 顯示 unknown。

## 測試與審查

所有新 build/test 經 shared workspace launcher，詳細命令／hashes 見 [receipt](2026-10-23-history-verification.json)。

| 實際執行 | 結果 |
| --- | --- |
| 初始 RED：全suite，history未實作 | 81 tests；1 failure與26 errors，日誌保留 |
| fractional timestamp RED | 重現同時間錯誤比較問題後修正 |
| WAL RED | 重現缺SHM時建立／有SHM時改動；5 expected failures保留 |
| root `python3 -W error::ResourceWarning -m unittest discover -s tests -v` | 84 PASS（原63＋新21） |
| independent reviewer 同suite | 84 PASS，來源hash匹配 |
| `python3 -m py_compile codex_usage.py agent_usage.py`／3.11 AST grammar | PASS；runtime3.13.5，不冒稱3.11 runtime |
| history JSON／table／範圍／截斷／非法limit，使用封存cc_quota.db()建立的合成schema | 5 CLI smoke PASS；DB hash/mtime不變，無raw洩漏 |
| `python3 scripts/check_project_success.py` | 全庫41 contracts與導航／索引PASS |
| scoped `git diff --check`／封存hash／新文件連結／索引產生器對照 | PASS |

獨立 T-973 最初 REWORK：SQLite mode=ro/query_only 仍會動 WAL共享記憶體檔。該失敗報告完整保留。
修正先檢查 WAL header 與 sidecars，history 在 SQLite connect 之前拒絕 WAL／SHM；存在-journal亦拒絕。
沒有使用可能忽略WAL資料的 immutable、轉換journal模式、checkpoint或刪sidecar。
T-974 重新跑原案例：穩定錯誤、無points、來源檔名/hash/mtime不變，最終 ACCEPT。

## 使用限制與交接

- history 目前不支援 WAL／sidecars；需穩定、未被同時替換或切換journal模式的來源。正常rollback-journal DB可用。
- 本次只用合成DB；沒有Claude真DB，沒有新live service呼叫。M2的Codex／OpenCode live證據屬前一切片。
- 原Codex可見status對照、Claude/Cursor live、其他provider自動quota、Python3.11 hosted CI仍未完成。
- 沒有commit/push/PR/merge/tag/deploy；任務板按repo規則保持in_progress直到合併。無服務啟停／憑證修改。

[使用指南](../agent-usage.md#claude-歷史與缺漏時段) 是目前入口；封存cc-quota不另立新的開發主線。
