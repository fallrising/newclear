# Signal Hub — STATUS

本檔是本專案唯一的進度權威。日期：2026-09-28。

## 目前狀態

**SDD v0.1 draft，只有文件。沒有程式碼、沒有部署、沒有完成 owner acceptance。**

| 項目 | 狀態 | 證據／限制 |
| --- | --- | --- |
| 產品邊界與既有專案分工 | 已整理 | knowledge-base `44.05` 筆記（PR #72 已合併） |
| 總綱與 01–06 詳細設計 | draft | 本目錄；schema 與 fixtures 尚待 M0 |
| 官方來源查核 | 已整理 | [SOURCES](SOURCES.md)；部分官方網站被網路 proxy 擋住，改讀官方 GitHub repository |
| 獨立 review／owner acceptance | pending | 自查不等於獨立審查 |
| M0–M5 實作 | not started | 沒有 Go module、前端 package 或 lockfile |
| M6 部署與真實資料 | not started | 需要另行授權 |

## 下一個最小切片

owner 接受設計並明確要求實作後，開始 M0：事件 JSON Schema、設定 schema（sources、rules、subscriptions）、OpenAPI、正反 fixtures，以及 webhook 簽章的 test vectors。M0 沒有 runtime，也不需要任何 secret 或主機。

第一個含可執行程式碼的 PR（M1）才加入 root path-scoped CI。

## 待 owner 決定

- 熱資料期實際天數（提案 90 天）與 rollup 保留期（提案 2 年）
- 圖表函式庫（候選 ECharts）
- 部署主機與設定 repo 的位置（私人資訊，不寫在本 repo）

## 續作規則

先核對實際 main、相關 PR 與本檔，不要只憑本檔判斷目前在哪個里程碑。每次完成時更新：固定 commit、實際執行的測試、未執行的項目與原因、待審項目、下一步。
