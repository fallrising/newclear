---
project: products/goku
purpose: 以命令列、訊息消費者與網頁管理書籤
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Goku 成功契約

## 主線與範圍

保留 CLI、HTTP API、MQTT consumer 與 Web 組成的書籤匯入／管理主線。
[README](README.md)明列 dormant；需要 owner 明確投入決定才能恢復產品工作，本次只記錄缺口。

不與 Ice Maker/Knowledge Base 另建競爭的知識工作流。
子專案各自可建置不等於四個入口互通；現存舊 clone URL 不應當成 monorepo 安裝步驟。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given SQLite 設定與合法書籤，When 經 API 建立、讀取、更新及刪除，Then 持久資料符合 API 契約 | pending | [API 入口](api/cmd/api/main.go)、[handler](api/internal/handlers/v1/bookmarks.go)存在；缺同版 runtime 驗收報告 |
| AC-02 | Given 現行 Web 與 API，When 使用者列出及修改書籤，Then 前後端路徑與資料形狀一致 | failed | [Web API client](web/src/services/api.ts)用 /api/bookmarks；[API main](api/cmd/api/main.go)掛 /api/v1，現有路徑不一致 |
| AC-03 | Given CLI 匯入或 MQTT 訊息，When consumer 寫入 API 再於 Web 查詢，Then 相同書籤可端到端操作且錯誤可診斷 | pending | [CLI](cli/README.md)、[consumer](consumer/README.md)：缺四元件整合與重啟證據 |

## 現況與缺口

Portfolio 曾記錄 Go tests 通過，但未附完整端到端資格，因此不提升 AC 為通過。
目前明確觀察到 Web 預設 base 與後端路由不一致；本輪沒有呼叫 live API。
即使調整 VITE_API_URL，仍須核對 CRUD path 和 response schema，不能宣稱只改一個設定即可修好。
Dormant 是投入狀態，不代表已完成或自動封存成無主線。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[API README](api/README.md)記錄 PORT 與 DB_PATH；在現有 monorepo 的 api 目錄執行下列命令，不重新 clone。

已核對入口：[API main](api/cmd/api/main.go)與 [Web package](web/package.json)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
go build -o goku-api ./cmd/api
./goku-api
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須先獲明確復工範圍，修正 API/Web 契約並完成 CLI/consumer/API/Web 整合與持久性驗證；沒有可用版本資格。


## FE round2 — 2026-10-24T10:05:22Z

T-0380 R2-AC-9/E approved M1–M3 only: environment example, accessible icon actions and visible API errors/retry. [Task](fe-review/tasks/round2/task.md) defines regression/native/isolated synthetic browser checks. Local R2 candidate verified; M1 staged tracking passed; independent acceptance and current CI remain pending; dormant exception only, existing API path mismatch and CLI/MQTT/mainline gaps unchanged. No dependencies, full R3, release or deployment.

| R2 item | Status | Required evidence |
| --- | --- | --- |
| M1 | passed (scoped) | Same nonsensitive env example, native build and parent staged `.env` absence passed; [evidence](fe-review/tasks/round2/evidence/env-staging.json) |
| M2 | passed (scoped) | Named icon actions, retained form semantics, real keyboard focus visibility |
| M3 | passed (scoped) | Actual store failure/recovery tests for four operations; visible alert/Retry vs empty; real owned mock outage/restart and controlled mutation errors |
| Evidence | partial | Native lint/build, scoped three-size capture, all-local requests and owned cleanup passed; [report](fe-review/tasks/round2/report.md) retains failures/limits; independent review/current CI pending |
