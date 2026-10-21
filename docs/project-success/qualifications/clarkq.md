# clarkq 可用版本資格

RESULT: PASS
Project: systems/clarkq
Tag: usable/clarkq/v1.5.1
Source: b97319d74f8442b5173ef42be72a0aa757d87df0
Startup: 隔離單機程序與文件 demo — passed
Core: 六情境 49 assertions，包含 FIFO、認證、長輪詢、metrics 與真實重啟持久性 — passed
Checks: go vet/test/build 及真 API demo — passed

範圍：推薦單機持久佇列；cluster/quorum 為實驗功能，不作跨機房保證。

2026-10-21 實跑證據：[原生 checks](../evidence/newclear-qualification/clarkq-commands.json)、[啟動與核心流程](../evidence/newclear-qualification/clarkq-core-attempt2-commands.json)；完整命令／輸出按同目錄 evidence index 逐項保留。
測試 checkout d62cf11d722f229c3a048e4021282aa5783b976e 的六個候選 component trees 與上列 Source 完全一致；本 PR 對產品只新增／修正文檔，未修改 runtime、依賴或設定。
資格不外推未列範圍。必要 PR CI／獨立審查及合併版本核對仍是發布上述預定 tag 的 gate；發布結果以遠端 Git ref 與需求卡交付紀錄為準。
