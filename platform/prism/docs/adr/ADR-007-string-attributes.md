# ADR-007：屬性統一為 map[string]string

## 狀態

Accepted

## 決策

Prism 的正規化遙測模型以 `map[string]string` 儲存 attributes。OTLP `AnyValue` 在 ingest 邊界以決定性的規則序列化為字串；之後的查詢、索引及儲存 SPI 不再攜帶任意型別值。

## 背景

OpenTelemetry attributes 可包含字串、布林、數字、陣列與複合值，但目標儲存後端對型別、索引和比較的支援差異很大。若把完整 `AnyValue` 傳入核心模型，每個驅動和查詢引擎都必須重複處理同一組型別轉換與邊界案例。

## 理由

- 單一字串表示能保持 Tier 1 儲存 SPI 小而一致。
- 在 ingest 一次完成正規化，可讓所有後端與查詢路徑得到相同結果。
- 字串 key/value 與 Prometheus labels、Loki labels 及多數文件型後端的索引模型容易對應。
- 決定性序列化可透過 golden tests 固定並跨驅動比較。

## 後果

- 原始數值或布林型別資訊在正規化後不再保留；需要數值運算的正式欄位必須使用訊號模型中的 typed field。
- 陣列與複合值必須有文件化、決定性且無歧義的序列化格式。
- 查詢比較 attributes 時預設採字串語意，不得依後端自行猜測型別。
- ingest 必須限制 key/value 大小並處理無效 UTF-8 或超深複合值。

## 替代方案

### 在核心模型保留完整 typed union

否決。這會把型別矩陣擴散到 SPI、所有驅動、索引及查詢比較器，大幅增加 conformance 負擔。

### 將任意值保存成不透明 JSON

否決。雖可保留部分型別，但會降低索引與查詢可攜性，且 JSON 數字、順序與編碼仍需額外規範。
