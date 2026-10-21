---
project: labs/aweshore
purpose: 保存個人筆記與 avatar LLM 的早期 PKM 實驗
kind: archived
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# aweshore 成功契約

## 主線與範圍

[README](README.md) 明示2024年停止開發、Tier D歷史保存；不重啟功能。
原構想包含個人 avatar LLM／vector database、pure/default筆記、自訂爬蟲摘要與Zapier/n8n。
本次結束條件是保留api/ui的真實來源與構想／實作差異，避免再次誤判成空殼。
[api 原需求](api/README.md) 不是已完成能力清單；canonical知識系統不轉移到本實驗。
封存狀態不等同原產品主線完成。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 表示具日期的既有結果。
沒有 runtime 重跑的項目不以文件檢查代替；pending／failed 保留原缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 已匯入歷史專案，When 查來源，Then Go API與Qwik UI均可追到各自master commit。 | passed | [README](README.md)：api504ad33、uif069fdf；兩個目錄均存在。 |
| AC-02 | Given 歷史需求，When 查筆記／avatar／摘要設計，Then 不把規劃文字宣稱為已驗證整合。 | passed | [API需求](api/README.md) 與 [UI入口](ui/package.json)；本契約明列邊界。 |
| AC-03 | Given 真實筆記資料，When 執行avatar、vector檢索及爬蟲整合，Then 核心PKM旅程可重現。 | pending | 沒有完整端到端驗收紀錄；已停止開發，不在本次補實作或測試。 |

## 現況與缺口

default main曾只有README/LICENSE，實際內容來自兩個master，已有匯入來源註記。
[api](api/) 含cmd/internal/pkg及mock資料；[ui](ui/) 為Qwik City前端。
現有程式足以保留工程歷史，不能外推為完整可用PKM。
未見avatar、vector與自動摘要完整交付證據。
與knowledge-base重疊不構成重新開發授權。

匯入來源版本維持README的歷史commit，不改用原repo空白main推斷內容。
保留api與ui各自邊界，不把共享筆記領域誤判為已完成整合。

## 啟動與驗證

沒有經目前環境驗證的整體啟動路徑。
原始API入口保存於 [cmd/server](api/cmd/server/)，需求與資料設計見 [API README](api/README.md)。
[UI package](ui/package.json) 有 `npm run dev`、build、lint 與型別建置入口。
本次未安裝舊依賴或接LLM／vector服務；也不新增封存項目的教程。
如考古需要執行，先核對舊工具鏈、設定與隔離資料，不沿用未核對的現代假設。

本次只核對文件、入口與證據，未執行產品建置、服務或外部整合。
歷史結果的範圍、來源與未執行項均須隨交接保留。

## 可用版本

目前 `usable_tag: none`。
封存案不建立可用標記。
恢復之前需owner另定範圍；原筆記、LLM、檢索與整合旅程仍須獨立驗收。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。
