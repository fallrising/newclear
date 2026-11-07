# UL：應用用量觀測部署

## 目標與範圍

依owner既有原Worker更新授權及本次繼續指示，將PR827固定六檔候選部署至原資源；保留D1、Access、secret bindings、Cron、角色scope與所有期限，不新增方案或付費。無runtime source改動，沿用UO實際387tests與14組本機瀏覽器證據；本輪只增加live部署／核驗及文件。

## 驗收

| AC | 驗收 |
| --- | --- |
| UL-01 | fresh原資源、固定source/hash、服務與有效期限核對；留存原version及可回退請求。 |
| UL-02 | 新asset session及三module／三asset部署，active version 100%；settings、secret bindings與原D1／Access／Cron不變。 |
| UL-03 | 回讀module與asset bytes、匿名Access302、有效runner self與無read scope的usage403；D1及journal原歷史保全、原runner持續執行。 |
| UL-04 | 公開證據、獨立審查、必要文件CI與PR交付；明確保留未驗證事項。 |

Bot與human授權已過期，不自動續期或借用角色。UL-03的403僅證明權限拒絕，不是route存在或成功usage快照的獨立證據；route存在另由module/source對照支持。正向live usage200、真人瀏覽器登入仍pending；可在owner準備好時另核准human-only短窗口。provider analytics／帳單未接線，完整AC08與mainline仍incomplete。

## 執行與回退

先保存私人intent及before receipts，核對原active version、settings、grants、schedule、Access與本機runner。只准資產session／bucket及既有Worker upload；不修改D1業務資料、角色或Cron。寫入結果未知先讀回，不盲重試。以部署前version的100% deployment回退程式；不PATCH settings來掩蓋歷史settings與active版本資源差異。讀回active version bindings確認實際資源。

Cron仍在執行；原terminal commands、firings、journal rows逐筆保留，允許合法新增與last_due推進，不以全DB相等凍結正常工作。部署前active非零先觀測，不取消／重放命令。Secrets用keep_bindings繼承，不將值放入候選或公開文件。

[來源證據](evidence/m1-usage-observation.md)；[部署證據](evidence/m1-usage-live.md)由本輪實際結果填入。

## Fresh觀測：既有unknown不隱藏

2026-10-31預檢發現此前健康命令已在reconciling，本機journal為unknown，後續Cron skipped_overlap。這不是本次部署造成；最初根因尚不明。已下載原Worker，逐byte比對HW候選，對UO差異僅新增usage唯讀函式與route，auth/protocol相等，claim/report/Cron行為未改。原未知命令的immutable body／identity／active slot及journal必須保留；允許原runner正常更新attempt fence／revision及後續skipped firings。完成先觀測的門檻後可發布唯讀更新，不宣稱修復健康排程、active0或重新得到healthy。不得為使部署檢查通過而clear／delete／replay未知命令；後續需獨立的可稽核處置設計。
