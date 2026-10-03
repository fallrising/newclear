# Signal Hub

> **Portfolio doc tier: A (active design)** — [文件政策](../../docs/portfolio-doc-tiers.md) · [投入決策](../../PORTFOLIO.md) · [進度與阻擋](docs/STATUS.md)。

個人用的多來源事件中樞。M2 已有可在本機執行的 Go runtime、SQLite WAL、事件 ingest／查詢、token 授權、Alertmanager v4 adapter、唯讀事件看板與來源新鮮度。從[快速開始](docs/quickstart.md)建置並執行；runtime 邊界見 [M1 runtime 契約](docs/runtime.md)，目前進度以[狀態文件](docs/STATUS.md)為準。

規則與指標、訂閱和投遞、保留與封存及部署仍是後續目標。專案不替告警系統評估告警，也不判斷或執行應對動作；決策系統與執行器屬於其他元件。

## 閱讀入口

- [快速開始](docs/quickstart.md)：建置、啟動及本機端到端範例
- [M1 runtime 契約](docs/runtime.md)：啟動限制、HTTP 邊界與已實作範圍
- [來源新鮮度契約](docs/source-freshness.md)：狀態轉換、認證來源歸屬與 M1 升級
- [狀態與下一步](docs/STATUS.md)：本專案唯一的進度權威
- [SDD 總綱](SDD.md) 與[詳細設計索引](docs/sdd/README.md)：完整目標架構與契約
- [契約與驗證](contracts/README.md)：JSON Schema、OpenAPI、fixtures 與 vectors
- [開發約定](AGENTS.md)

## 責任邊界

| 已提供的 M1–M2 能力 | 後續目標 |
| --- | --- |
| 接收、驗證、授權、去重並保存事件 | 保留清理、封存與還原 |
| 按條件查詢事件、來源新鮮度 | 規則計算指標、門檻事件 |
| Alertmanager v4 webhook 轉換 | 訂閱、投遞、重試與 DLQ |
| 同一 Go binary 提供唯讀時間線與詳情 UI | 部署與持續運作 |

## 授權

沿用 repository 根目錄 MIT。
