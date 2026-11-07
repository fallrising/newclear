# 公開匯入驗證

2026-10-31；範圍為來源、設定、fixtures、鎖檔與公開摘要匯入，外加 `STRATA_HOME` 路徑選擇與內附資源 guard。

| 檢查 | 實際結果 |
| --- | --- |
| publication checker | 44 個公開來源檔；Python／Node／JSON／TOML 語法、個人路徑與常見 credential pattern、runtime 檔案排除及 Markdown 本地連結通過 |
| local_office_policy.test.mjs | 5 tests passed，包含 provider、model、workspace、worktree、shell worker 與 owner 參數 |
| 搬移後 prepare-only | 從新元件目錄、指定既有外部 STRATA_HOME，成功產生 32K 設定／合成 fixture；status=prepared、cleanup_errors=[]，未啟動模型 |
| repo 共用 unit tests | `python3 -m unittest discover -s scripts/tests -v`：20 tests passed |
| project contracts | 50 contracts 通過，已產生 PROJECTS 索引；完整 indexes gate 在 staged source 上執行 |

證據可由 README／SETUP 的命令重跑。public checker 是基本 pattern／檔案清單檢查，不宣稱完整 secret scanner。
GitHub Actions 另外跑元件離線檢查、共用索引與 workflow lint；結果以匯入 PR 為準，合併／遠端回讀後在任務板補交付記錄。

本次沒有重跑大型模型、614 個上游測試，或全新機器的模型下載／安裝。歷史結果見 [摘要](README.md)。
