# Signal Hub

> **Portfolio doc tier: A (active design)** — [文件政策](../../docs/portfolio-doc-tiers.md) · [投入決策](../../PORTFOLIO.md) · [quickstart／目前阻擋](docs/quickstart.md)。

個人用的多來源事件中樞，也就是戰情室。它把發佈、巡檢、新聞、告警、業務日誌衍生事件等資訊收成統一的 CloudEvents 事件，提供按時段查詢的時間線、由規則生成的指標圖表，並把事件投遞給自己的其他系統（第一個是 AI 決策系統）和手機通知。

**目前只有 SDD，沒有程式碼、沒有部署。** 文件中的 API、schema、路徑與數字都是待實作的契約或設計假設，不能當成已可使用的功能。

## 閱讀入口

- [SDD 總綱](SDD.md)：範圍、架構、責任邊界與設計決策
- [詳細設計索引](docs/sdd/README.md)：事件模型、儲存與封存、指標規則、訂閱投遞、看板與 API、安全與驗收
- [狀態與下一步](docs/STATUS.md)：本專案唯一的進度權威
- [來源](docs/SOURCES.md)：官方規格與設計依據
- [開發約定](AGENTS.md)

## 責任邊界

| 屬於 Signal Hub | 不屬於 Signal Hub |
| --- | --- |
| 接收、驗證、去重、保存事件 | 產生事件的業務邏輯（由各生產者負責） |
| 規則生成的指標、門檻事件 | 告警規則評估的替代品（Alertmanager 繼續負責告警收斂） |
| 時間線、指標圖表、來源新鮮度 | 原始日誌的保存與全文搜尋 |
| 訂閱、投遞、重試、DLQ | 判斷「該怎麼辦」：屬於決策系統 |
| 封存與還原 | 執行任何動作：屬於執行器 |

決策系統（策略庫、AI 推薦、人選擇）與執行器是另外的元件，有各自的 SDD；本專案只定義它們與中樞之間的事件契約，見 [04 訂閱與投遞](docs/sdd/04-subscriptions-and-delivery.md#決策系統契約)。

設計背景見 knowledge-base `44.05 Signal hub` 筆記。

## 授權

沿用 repository 根目錄 MIT。
