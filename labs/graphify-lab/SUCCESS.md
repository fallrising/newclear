---
project: labs/graphify-lab
purpose: 實跑 Graphify 開發場景並驗證固定參考程式碼與索引的單份共用
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-29
source_commit: 68c92afda47187ec40a8dff319eb377da9998145
---

# Graphify lab 成功契約

## 主線與範圍

依 [SDD](SDD.md) 建立真實 Graphify 試用與可重現共用 cache。範圍是本機 code-only、公開來源及 stdio MCP，不含部署、付費模型、取代原始碼或完整靜態分析保證。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 upstream／套件，When 安裝並讀回，Then 版本與來源可追溯。 | pending | 實作前契約，待執行。 |
| AC-02 | Given 已知 source，When 導覽、定位及追蹤，Then 真 graph 命中 symbol／行號／路徑且負例有效。 | pending | 待整合 suite。 |
| AC-03 | Given 真實 newclear 元件與公開 reference，When 建圖查詢，Then 得到非空圖及可核對來源。 | pending | 待真實專案驗證。 |
| AC-04 | Given 已知 caller／test，When 查修改影響，Then 結果包含預期依賴並標明限制。 | pending | 待影響分析驗證。 |
| AC-05 | Given 修改及髒快取，When 更新或重用，Then 新舊符號與失效狀態正確。 | pending | 待增量及負例。 |
| AC-06 | Given 兩個獨立圖，When 合併，Then namespace／provenance 保留且正負例可區分。 | pending | 待跨專案驗證。 |
| AC-07 | Given 兩個 consumer，When 取同 revision，Then 共用相同來源與索引並保護並行／損壞。 | pending | 待 cache 實作與驗證。 |
| AC-08 | Given 冷暖執行，When 量測，Then 證據記錄 bytes／時間與計算假設。 | pending | 待 benchmark。 |
| AC-09 | Given 真 stdio MCP 與完整變更，When 執行 gates，Then handshake／查詢、整合測試、索引及獨立審查通過。 | pending | 待實作與交付。 |

## 現況與缺口

Owner 直接指示，T-0001／Session `Graphify-20261029`。先認領，再實作、驗證、獨立審查及 Draft PR。完整規格與任務列見 [任務板](docs/tasks/BOARD.md)。目前所有 runtime 驗證尚未執行。

## 啟動與驗證

入口見 [README](README.md)；完成實作後補具體命令與證據。

## 可用版本

`usable_tag: none`。本次 Draft PR；未明確授權不 merge、release 或 deploy。
