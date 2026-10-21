# Signal Hub

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: A (active)** — [文件政策](../../docs/portfolio-doc-tiers.md) · [投入決策](../../PORTFOLIO.md) · [進度與阻擋](docs/STATUS.md)。

Race detector 只在本機手動跑：在 `platform/signal-hub` 執行 `go test -race -count=1 ./...`。Pull request CI 跑 `go test`，不加 `-race`。

個人用的多來源事件中樞。M5 已有可在本機執行的 Go runtime、SQLite WAL、事件 ingest／查詢、token 授權、Alertmanager v4 adapter、唯讀事件看板、來源新鮮度、版本化規則指標、SVG 圖表，以及 webhook／ntfy 投遞、摘要、重試、DLQ 與 owner 重放。從[快速開始](docs/quickstart.md)建置並執行；runtime 邊界見 [runtime 契約](docs/runtime.md)，目前進度以[狀態文件](docs/STATUS.md)為準。

M5 提供驗證後封存清除、可重複匯回、一致 SQLite 備份與隔離還原；自動維護需要明確指定目錄。M6 以[個人使用驗收](docs/sdd/06-security-operations-acceptance.md)為目前範圍：先接一個有用來源，確認單一實例的持久資料與可用備份；可選非 root Docker，不綁 OneFleet 改造。已有三來源範例與離線工具可沿用；三來源七天、手機及獨立停機通知改為選用的擴展驗收。實際接入與持久部署仍依 STATUS 記錄，不能由合成測試推定。專案不替告警系統評估告警，也不判斷或執行應對動作；決策系統與執行器屬於其他元件。

## 閱讀入口

- [快速開始](docs/quickstart.md)：建置、啟動及本機端到端範例
- [個人 Docker 啟動包](deployment/docker/README.md)：Linux 非 root 執行、私人設定、持久資料與備份還原
- [runtime 契約](docs/runtime.md)：啟動限制、HTTP 邊界與已實作範圍
- [來源新鮮度契約](docs/source-freshness.md)：狀態轉換、認證來源歸屬與 M1 升級
- [M6 設計](docs/m6-design.md)、[來源接入](docs/source-integration.md)與[選用擴展驗收包](docs/deployment-acceptance.md)：個人接入、失敗復原與擴展運維的適用範圍
- [狀態與下一步](docs/STATUS.md)：本專案唯一的進度權威
- [SDD 總綱](SDD.md) 與[詳細設計索引](docs/sdd/README.md)：完整目標架構與契約
- [契約與驗證](contracts/README.md)：JSON Schema、OpenAPI、fixtures 與 vectors
- [開發約定](AGENTS.md)

## 責任邊界

| 已提供的 M1–M5 能力 | 後續目標 |
| --- | --- |
| 接收、驗證、授權、永久去重、封存／匯回及一致備份／隔離還原 | 真實環境復原作業 |
| 查詢事件、來源新鮮度、規則指標與門檻事件 | 真實生產者持續驗證 |
| Alertmanager v4 webhook 轉換；webhook／ntfy 即時與摘要投遞 | 部署與持續運作 |
| 同一 Go binary 提供看板、投遞狀態與理由必填 DLQ 重放 | 實際帳號／tailnet 驗收 |

## 授權

沿用 repository 根目錄 MIT。
