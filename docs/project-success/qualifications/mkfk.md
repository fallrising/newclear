# mkfk 可用版本資格

RESULT: PASS
Project: systems/mkfk
Tag: usable/mkfk/v0.1.0
Source: b97319d74f8442b5173ef42be72a0aa757d87df0
Startup: 原生三 broker 程序／Compose demo — passed
Core: leader failover、dedup、rebalance、coordinator restart 及 full chaos 28 faults — passed
Checks: fmt/vet/unit/race/model/integration/full-chaos/demo — passed

範圍：M0–M7 教學 distributed log；不提供 Kafka wire相容、TLS/auth、retention 或 production hardening。

2026-10-21 實跑證據：[原生 checks](../evidence/newclear-qualification/mkfk-commands.json)、[啟動與核心流程](../evidence/newclear-qualification/mkfk-core-commands.json)；完整命令／輸出按同目錄 evidence index 逐項保留。
測試 checkout d62cf11d722f229c3a048e4021282aa5783b976e 的六個候選 component trees 與上列 Source 完全一致；本 PR 對產品只新增／修正文檔，未修改 runtime、依賴或設定。
資格不外推未列範圍。必要 PR CI／獨立審查及合併版本核對仍是發布上述預定 tag 的 gate；發布結果以遠端 Git ref 與需求卡交付紀錄為準。

[完整 chaos](../evidence/newclear-qualification/mkfk-full-chaos-commands.json)已在目前程式執行；舊 extended 1000×10000 stress／效能資料僅作歷史紀錄。原驗證規範將 extended 標為 optional，現行必要 100×1000 model 已通過；沒有把舊 extended 結果當新版本證據。
