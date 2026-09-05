# ADR-002：以 database/sql/driver 模型設計儲存 SPI

## 狀態

Accepted

## 決策

Prism 儲存層採用類似 Go `database/sql/driver` 的 SPI：所有驅動實作最小且穩定的 Tier 1 介面，進階能力由可選的 Tier 2 介面提供，並以 capability discovery 明確宣告。

## 背景

Prism 必須支援能力差異很大的後端。部分後端可以下推完整查詢、聚合及分頁，另一些後端只能儲存和掃描基礎資料。若把所有功能放進單一介面，弱後端會被迫偽造能力；若只保留最低共同能力，強後端又無法發揮原生優勢。

## 理由

- 最小核心介面能保持驅動實作門檻可控。
- 可選介面讓高能力後端提供查詢下推等最佳化，而不污染基本契約。
- capability discovery 讓規劃器在執行前選擇下推或 fallback，避免以執行錯誤猜測能力。
- `database/sql/driver` 已證明「小型必要介面加可選能力」能支撐多樣化後端。

## 後果

- Prism 必須提供 fallback engine，補足後端沒有宣告的能力。
- 每個驅動都必須通過共同 conformance suite，且 capability 宣告必須與實際行為一致。
- 同一查詢的下推與 fallback 路徑必須做 differential test，防止語意漂移。
- 新增 Tier 1 方法會提高所有驅動的相容成本，因此必須極度審慎。

## 替代方案

### 僅支援 ClickHouse 等單一資料庫

否決。單一後端能降低初期工程量，但違反 Prism 的儲存可攜性目標，並把部署、授權與營運選擇綁定在特定產品上。
