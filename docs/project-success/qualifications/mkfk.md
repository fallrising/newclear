# mkfk 可用版本資格

RESULT: FAIL
Project: systems/mkfk
Tag: none
Source: b97319d74f8442b5173ef42be72a0aa757d87df0
Startup: 原生三 broker 程序／Compose demo — passed
Core: leader failover、dedup、rebalance、coordinator restart 及 full chaos 28 faults — passed
Checks: 本機 fmt/vet/unit/race/model/integration/full-chaos/demo passed；最終 PR CI short chaos failed

範圍：M0–M7 教學 distributed log；不提供 Kafka wire相容、TLS/auth、retention 或 production hardening。

2026-10-21 實跑證據：[原生 checks](../evidence/newclear-qualification/mkfk-commands.json)、[啟動與核心流程](../evidence/newclear-qualification/mkfk-core-commands.json)；完整命令／輸出按同目錄 evidence index 逐項保留。
測試 checkout d62cf11d722f229c3a048e4021282aa5783b976e 的六個候選 component trees 與上列 Source 完全一致；本 PR 對產品只新增／修正文檔，未修改 runtime、依賴或設定。
歷史本機資格不外推未列範圍；本次候選已撤回，須先完成失敗診斷與重新驗收，才可再提出 tag。

[完整 chaos](../evidence/newclear-qualification/mkfk-full-chaos-commands.json)已在目前程式執行；舊 extended 1000×10000 stress／效能資料僅作歷史紀錄。原驗證規範將 extended 標為 optional，現行必要 100×1000 model 已通過；沒有把舊 extended 結果當新版本證據。

## 最終 CI 推翻候選資格

[run 39631545715 attempt 1](https://github.com/fallrising/newclear/actions/runs/39631545715/attempts/1) 在 c0f49d40f8a401efd51b79a70867d0cf30eb0363 的必要 short chaos 失敗（115.59 秒），其餘 native gates／demo 通過。helper 只印摘要，upload-artifact 的 hidden-file 預設導致 seed／完整違例未保存，API artifacts 為空；原因未知，不推定為 runner 問題。

上述本機成功證據保留，但不再支持發布 usable tag。CI 已限定補存 chaos.log／chaos-report.json；重跑使用新的 time-based seed，成功也不能解釋或消除已知失敗。需先完成故障診斷／重播及對應驗證；本次不修改產品 runtime。
