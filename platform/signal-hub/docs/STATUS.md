# Signal Hub — STATUS

本檔是本專案唯一的進度權威。日期：2026-10-03。

## 目前狀態

**M0 契約已實作、待 PR 審查；沒有 runtime、前端、資料庫或部署。** 本次開發指令以 SDD v0.1 為 M0 基準，不代表 M1–M6 或未定部署選項已驗收。

| 項目 | 狀態 | 證據／限制 |
| --- | --- | --- |
| 事件／sources／rules／subscriptions／filter／完整設定 | 已建立 | `contracts/schemas/`，JSON Schema 2020-12 |
| API 契約 | 已建立 | `contracts/openapi.json`，OpenAPI 3.1.1，12 paths／13 operations |
| 正反 fixtures、canonical／簽章向量 | 已驗證 | `contracts/check.py`；結果見下 |
| 獨立模型審查 | passed | gpt-6-astra 複核四項修正並重跑 checker；只涵蓋 M0 契約 |
| 完整設計與功能 owner acceptance | pending | M0 開工不等於整體功能驗收 |
| M1–M6 | not started | 沒有 server、UI、migration 或真實資料 |

## 交付證據

- 固定來源 commit：`e2c901304570428a5c78744e274739206dbf3387`。M0 提交 SHA 由本檔所屬 PR 的 commit 固定，不自填循環引用。
- 環境：Linux、Python 3.12、隔離 venv；實際安裝的版本鎖在 `contracts/requirements.txt`。
- 執行：`python contracts/check.py`（元件目錄內）；通過6份 schema、61個正反 fixtures、15個 webhook 向量、5個 canonical 向量、16 KiB UTF-8 邊界、strict JSON、RFC 4231 及完整 OpenAPI 驗證。
- 向量可以由 `contracts/generate_vectors.py` 重生。測試 secret 全為合成 bytes，不讀帳號或 secret 檔。
- root CI 依本次 M0 範圍尚未接線；首次 runtime PR 加入本專案 path-scoped CI。契約檢查是離線工具，不是 runtime。
- 未執行：Go/runtime、資料庫、UI、token 認證與真實 HTTP 投遞、主機／tailnet／部署，因為尚無實作且本次不含這些階段。

## 風險與下一步

- M0 固定下的批次回應、JCS bytes、filter、webhook immediate 與 daily ntfy digest 細節見 [契約](../contracts/README.md)。schema 與 checker 通過不證明持久化、SSRF 防護或 at-least-once 行為已驗收。
- 下一個最小切片為 M1：Go ingest／來源授權、SQLite schema、source+id 去重／衝突、查詢 API與專屬CI；另行點名後開始。
- 熱資料90天／rollup2年仍是提案；圖表函式庫、部署主機與私人設定位置留到對應階段決定。
