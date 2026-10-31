# Cloud Lab 尚未完成的工作

2026-10-31接續盤點。以[成功契約](../SUCCESS.md)的AC及[任務板](tasks/BOARD.md)為權威；這份清單提供接續順序，不建立第二份完成狀態，也不把新增功能當成無止境的必要條件。

## M1 完成門檻

| 門檻 | 已有證據 | 還缺什麼／由誰處理 |
| --- | --- | --- |
| AC-06：API／排程／bot與看板閉環 | 真實API及獨立Grok MCP工具→原runner→validated；[修正版HL](evidence/m1-health-schedule-window-live.md)已驗真實Cron→原runner→validated | Owner已於2026-10-31用Safari登入並讀取用量，122／84／1與管理聚合一致；human-only批准窗口12:08:10Z–12:38:10Z不自動延長。完整操作流程仍與unknown處置／模型缺口分開，手機為選測 |
| Grok自然語言調度 | 原生client已發現兩個固定工具，真實工具提交與持久配額驗證通過 | 尚未由實際模型對話選用工具。既有接線不證明模型流程；先確認owner可用模型入口及費用限制，不能以「繼續開發」推定批准付費模型呼叫 |
| AC-07：完整故障矩陣 | [RF](evidence/m1-remote-recovery.md)已驗遠端回報前斷線、ACK遺失、started後終止、撤權後reconcile及舊fence拒絕；本機另有正反例 | [逐列矩陣](failure-matrix.md)已完成對齊，FQ補取消／deadline／回報競爭的local隔離驗證；接續補成果下載完整性／拒絕稽核，並設計unknown/in-flight隔離還原。事件seq與通知場景尚未實作，須對齊原契約，不自行豁免。不得以三個遠端案例替代全部矩陣；不為驗收直接中斷原live runner |
| AC-08：配額／成本／保留與恢復 | 隔離D1還原、journal對帳、Access service-token撤權及bot本機持久上限已有證據；[QV隔離應用上限](evidence/m1-quota-qualification.md)補API／Cron邊界、窗口及歷史保全 | [UO](evidence/m1-usage-observation.md)應用額度API／手動看板已完成source/local驗收，[UL](evidence/m1-usage-live.md)已發布，Safari真人功能讀取已確認；額外asset hash依owner指示取消，未執行不記通過；[保留方案](retention.md)已定義不自動刪除、到期不等於回收及archive/tombstone/restore前置；清理工具尚未實作，provider用量來源仍待接線。Cloudflare供應商配額實際耗盡／帳單仍未驗；不以壓滿免費額度或升級測試。刪除歷史前另有具體保留／恢復方案及批准 |
| 最終整合驗收 | 各子里程碑都有獨立證據與Git交付 | 所有必要AC、CI及獨立審查完成並合併後，才依repo規則建立usable tag；目前仍為mainline incomplete／usable_tag none |

2026-10-31 fresh觀測原09:15命令在journal為unknown，佔active槽且後續Cron skipped_overlap；原結果保留，不能清DB／標成功／重播解鎖。其後owner已批准[顯式結案](evidence/m1-unknown-resolution-live.md)：原結果unknown保留、active槽釋放，18:00新Cron validated/healthy。接續補AC-07／08的可重現隔離驗收；Safari真人登入已驗，不重開窗口。不要為等待owner而反覆續人類grant，也不要重建bot state來重置額度。

## 時間限制與操作責任

- 原runner policy上限為2026-11-05T07:24:26Z，實際resident保守停止時間及本次排程截止為07:24:25Z；上限不是未來uptime保證。
- 排程policy到期會拒絕新命令，但不會自動刪除Cloudflare Cron設定；provider仍可呼叫handler，後者先讀schedule再檢查policy。到期收尾需核對原Cron與在途狀態後處理，不能把「沒有新命令」當成「沒有平台呼叫／用量」。
- 首期bot政策截止2026-10-30T18:00:27Z。工具入口保留不代表到期後仍可提交；續租保留原請求與歷史，須沿已實作的顯式流程及新期限批准，不自動延長。
- Access machine token截止2026-11-05T07:43:27Z；本次沒有延長。真人Access成功也不代表human grant有效，兩層需分別驗證。
- Workers Free／不新增付費是owner限制。實際用量和帳單不能填零；缺權限的analytics應明示unknown，不另建token或改套餐繞過。

## 原始願景的後續階段

[SDD](../SDD.md)的M2/M3仍是後續範圍：受控workload操作、外部agent adapter、按案例引入Queues／Workflows、模板生成與候選專案遷移／封存。它們各有責任與授權gate，不屬這次單節點唯讀M1的隱藏完成條件。封存前必須證明接替、資料／在途工作對帳與回退，不因程式集中到同一目錄就刪舊專案。

對owner的完成提示須明確區分「本次HL里程碑完成」、「M1主線完成」及「長期M2/M3願景完成」。目前不能宣告所有任務完成。

[UR未知結案](unknown-resolution.md)source／隔離驗證與後續[ULR線上操作](evidence/m1-unknown-resolution-live.md)已完成：原命令closed_unknown、result仍null、journal保留，新Cron成功。無需重測ownerSafari或續其授權；原unknown原因仍未確定。
