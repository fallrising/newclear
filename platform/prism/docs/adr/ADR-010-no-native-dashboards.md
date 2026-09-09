# ADR-010：v1 不建立自有 dashboard 系統

## 狀態

Accepted

## 決策

Prism v1 不實作自有 dashboard 建立器或遙測視覺化系統。資料探索與 dashboard 使用 Grafana 等相容工具；Prism 自有 UI 僅處理設定、狀態、使用量與其他控制平面工作。

## 背景

完整 dashboard 產品需要圖表元件、查詢編輯器、變數、權限、分享、版本管理與大量互動行為。這些能力已有成熟生態系工具，而 Prism 的核心任務是提供相容的資料與控制平面；在 v1 同時重建視覺化產品會分散有限工程容量。

## 理由

- ADR-001 的相容 API 已允許 Grafana 直接查詢 Prism。
- 重用成熟 dashboard 工具能更早交付完整的 metrics、logs 與 traces 工作流程。
- Prism UI 可專注在外部工具不負責的設定、健康狀態與資源治理。
- 避免維護另一套圖表、查詢編輯與 dashboard 儲存格式。

## 後果

- 使用者需要部署或使用外部視覺化工具才能建立 dashboard。
- Prism 必須持續驗證 Grafana datasource 與 provisioning 相容性。
- Prism 可提供範例或預建 dashboard artifacts，但不擁有其編輯與呈現引擎。
- 若未來需要原生 dashboard，必須另立 ADR 評估 Perses 等可嵌入方案及其授權與維護成本。

## 替代方案

### 在 v1 建立 Prism 原生視覺化與 dashboard 編輯器

否決。此方案會重複成熟工具的大量功能，擴大前端、相容性與持久化範圍，並延後核心資料平面交付。

### 立即嵌入 Perses

暫不採用。它是未來可評估的方向，但 v1 尚無足夠需求證明必須承擔嵌入、升級與整合成本。
