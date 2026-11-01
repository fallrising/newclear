# Agent Usage M2 本地交付報告

Owner 要求開發多來源並整合重複功能。統一入口是 `tools/codex-usage/agent_usage.py`；
原 Codex collector 不重寫，Claude 讀既有 cc-quota SQLite 或官方 statusline capture。
cc-quota 獨有的歷史／launchd／通知保留，沒有新建第三個 quota 專案。

## 實作與驗證

- 七 provider registry、單次 JSON/table、partial exit2、具時間戳 manual、來源／scope／identity／stale 分開。
- Codex 重用唯讀 collector；Claude SQLite mode=ro、statusline whitelist/0600；OpenCode 固定 stats 命令；Cursor 固定官方 Admin spend API、env key、不跟隨 redirect、唯一 email 比對。
- 不調用模型；token、本機統計、API 費用、訂閱百分比不相互推算，不加總共享池。
- worker 在隔離 worktree，root 只帶回兩個新程式／測試檔及報告；root 獨立審查差異及重跑。
- 初始 RED 缺 module、語意 RED、Cursor pagination RED、review RED 均保留。審查發現 ISO 微秒捨入誤報未來與 HTTPException 未隔離，修正後 reviewer ACCEPT。

本次實際執行（所有新 build/test 經共用 workspace launcher）：

| 檢查 | 結果 |
| --- | --- |
| Codex 舊 baseline：`python3 -W error::ResourceWarning -m unittest discover -s tests -v` | 33 PASS |
| 統一入口／Codex：同命令，root 與 reviewer 各自重跑 | 63 PASS，含原33＋新30 |
| Claude 後端：同命令，於 tools/cc-quota | 35 PASS；兩套不重複合計98 |
| `python3 -m py_compile codex_usage.py agent_usage.py` 與 Python3.11 AST grammar | PASS；本機 interpreter 3.13.5，非3.11 runtime claim |
| `sources`、無設定 snapshot、statusline capture、partial JSON/table、選定來源 snapshot | 6 個 CLI smoke PASS；Claude／manual 為 synthetic |
| 統一 snapshot 選定 Codex／OpenCode | 初次 sandbox exit1；核准沙箱外重試 exit0，兩來源均 ok |
| `scripts/check_project_success.py --projects tools/codex-usage tools/cc-quota --contracts-only` | 2 contracts PASS |
| scoped `git diff --check` | PASS |
| teamctl validate-task／validate-report（T-970、T-971），新文件連結、example config、reviewed hashes | PASS |

[去識別真快照](2026-10-23-agent-usage-live.json) 及 [驗證 receipt／hashes](2026-10-23-agent-usage-verification.json)
記錄未提交來源及真讀取結果。私人 config／target／stdout 留在 shared workspace 的 preserve 區，未寫入公開 repo。
核准重試只為已授權唯讀查詢，不含模型 turn、登入操作或付費 API。

## 各來源完成度

| 來源 | 本次結果 | 尚缺 |
| --- | --- | --- |
| Codex | 統一入口真採集、身份通過 | 原 AC-04 同帳號可見 status 對照 |
| Claude | DB readonly／capture 與 CLI fixture 通過 | 使用者現有 DB／capture 真資料；不為取資料開模型 turn |
| OpenCode | 已安裝 CLI 真 stats 成功，rounded 值標 approximate | Go 訂閱 quota 仍 unknown；本機 stats 包含全部 providers |
| Cursor | 官方 transport、身份、錯誤、spend 邊界 mock 通過 | 有權限團隊 Admin API key 環境變數與 expected email |
| Grok | manual 可用，無既有 sessions 可觀察 usage 格式 | 未驗證 headless quota adapter；不猜 parser |
| Grok Bot／Antigravity | manual 可用 | 未驗證 headless quota adapter；方案共享池不推斷 |

## 驗收結論

M2 AU-01–05 在其明示能力／離線與可用真來源範圍本地通過。整體主線仍 incomplete：
原 live gaps、各來源真資料、Python3.11 hosted CI／Git 合併未完成；manual 不算自動 quota 支援。
CI 已更新為統一／Codex＋Claude regression；未執行 hosted CI，不引用其他元件的合併作為本次證據。
沒有 commit、push、PR、merge、tag 或 deploy，沒有變更 user credential／settings 或搬移既有資料。
