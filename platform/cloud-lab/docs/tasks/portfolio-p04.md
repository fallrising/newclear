# P04 — Cloud Lab 能力與期限對帳

Owner 指示繼續開發並允許 Claude Code 技術支持；本輪只對帳既有能力與設計，不啟動 CA runtime。原規劃基準為 `2aa21f10b53ecaeb079279b6531bbb47a103e937`；開工 newclear 基準 `1f855489328736a2578bb0c9e7d76e688b4f5bf8`，相關 Cloud Lab／Edge Ops 與 AGENTS 無差異。

## 目標、範圍與驗收

新增 `docs/portfolio-capability-audit.md`；依 repo 要求同步本元件 SUCCESS、README、BOARD、本任務與證據頁及根 README 導航。不改原 AC、SDD、AGENTS、程式、schema、權限、安裝或部署。

| AC | 可檢查結果 |
| --- | --- |
| P04-01 | IR／MC／ML 已交付 inventory 與 CA 提案分列；Pages／Tunnels 的歷史403仍 unknown；保留 Edge Ops 不可替代責任與未實作缺口 |
| P04-02 | 列出 runner／scheduler／policy 原截止與查核日期；human 12月2日只屬歷史政策，當前 live／登入未知 |
| P04-03 | consumer 不取得 host／catalog writer；固定來源與原 AC、比較／不採用理由、回退及原驗收保留可追溯 |

設計：能力矩陣＋期限矩陣＋唯一 writer／下一步 gate；沿用原來源作權威，不複製完整規格。私人來源只以角色 P-CF／P-HOST 引用，完整 SHA、路徑與差異保存在私人交接證據，不公開主機、帳號或設定。新增來源的事件摘要／同機傳送不等於 Cloud Lab 自動更新或真來源已接通。

## 協作與驗證

Lead 唯一 writer。依最新 owner 授權，以 cli-team 方法請 Claude Code 2.1.317／`claude-opus-5-5`、high，做一次有界技術設計與文件候選審查；一個新 session，最多240秒＋10秒清理，不重試、不換模型、不委派。只提供公開來源及去識別角色摘要，工具／MCP／skills 關閉、hooks 與自訂 plugins 停用；不是 OS 全程序隔離。成本／帳務未知，既有訂閱授權不代表免費。這是當次明確批准的設計審查，不是產品模型驗收或擴大測試。

驗證：固定來源與連結、原 AC／SDD／runtime 未變、公開邊界、`python3 scripts/check_indexes.py`、staged diff；必要 GitHub CI 包含 Cloud Lab local implementation、project-success、llms。文件本地不額外跑產品／live／benchmark；既有必要 CI 原樣執行。原擬由 Claude 給獨立建議；本次 OAuth 失效未取得結果，改由明示的 Codex reviewer 完成 repo 必要獨立審查，lead 核對處理；實際結果另記證據。

交付沿用工作分支→PR→必要 CI／審查→正常 merge→遠端回讀，之後 board-only PR 填實際合併時間。回退僅撤新增對照與導航，不宣稱撤銷未知外部效果。需要產品／主機／權限變更時停止，不自行啟動下一里程碑。

## Claude 路徑結果與必要審查

一次 CLI 啟動於驗證身分時失敗：`OAuth session expired and could not be refreshed`，exit1，0.415秒；modelUsage 為空，沒有技術意見，provider 請求／帳務未知。init 顯示指定模型、tools/MCP/skills 空清單；四個 CLI 內建 plugins 仍列出，不能宣稱所有 plugins 完全消失。沒有工具呼叫、重新登入、重試或靜默換模型。此為可選技術支持未完成，並非 Claude ACCEPT。

已明示改用一名 Codex 唯讀 reviewer 完成本 repo 必要獨立審查，最多8分鐘＋一次有界修正／最終證據核對；不委派、不修改檔案。原 Claude 輸入僅公開文件與去識別角色摘要，無私人原檔。實際建議及 lead 決定見本輪證據。
