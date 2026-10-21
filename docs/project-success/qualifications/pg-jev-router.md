# pg-jev-router 可用版本資格

RESULT: PASS
Project: labs/pg-jev-router
Tag: usable/pg-jev-router/v0.1.0
Source: b97319d74f8442b5173ef42be72a0aa757d87df0
Startup: 原生 lab demo 與隔離 PostgreSQL — passed
Core: 真擴充套件整合與 lab request routing；provider 明示為 synthetic — passed
Checks: make check、demo、real PostgreSQL Docker integration — passed

範圍：真 PostgreSQL／pg-jev 擴充套件＋合成 provider 的有界實驗；沒有 live LLM provider 驗收。

2026-10-21 實跑證據：[原生 checks](../evidence/newclear-qualification/pg-jev-router-commands.json)、[啟動與核心流程](../evidence/newclear-qualification/pg-jev-router-commands.json)；完整命令／輸出按同目錄 evidence index 逐項保留。
測試 checkout d62cf11d722f229c3a048e4021282aa5783b976e 的六個候選 component trees 與上列 Source 完全一致；本 PR 對產品只新增／修正文檔，未修改 runtime、依賴或設定。
資格不外推未列範圍。必要 PR CI／獨立審查及合併版本核對仍是發布上述預定 tag 的 gate；發布結果以遠端 Git ref 與需求卡交付紀錄為準。
