# ADR-004：以 clean-room 方式自行實作 LogQL

## 狀態

Accepted

## 決策

Prism 自行實作其支援的 LogQL 子集，不匯入 `grafana/loki` 套件，也不閱讀、複製或改寫 Loki 的 lexer、parser、planner 或 executor 原始碼。實作只能依據公開語法/API 文件、公開協定，以及獨立觀察所得的 HTTP 請求與回應行為。

## 背景

Loki 實作採用 AGPL 授權。Prism 需要提供 Loki API 相容性，但不應讓 Loki 的實作程式碼或衍生內容進入 Prism 的授權邊界。

## 理由

- API 與協定形狀可由公開規格及黑箱行為獨立實作。
- clean-room 邊界能保留工具相容性，同時避免把 AGPL 實作納入 Prism。
- 明確限制可讓後續貢獻者及審查者以可稽核的方式判斷來源。

## 後果

- 每位參與 LogQL 實作的人員或 agent 必須先閱讀並簽署 [ADR-004 clean-room 聲明](./ADR-004-cleanroom-declaration.md)。
- CI 必須阻擋 `grafana/loki` 及其他禁止來源的匯入。
- Prism 必須公開記錄實際支援的 LogQL 子集；未支援語法應回傳明確錯誤。
- 相容性應使用自行撰寫的 fixtures、公開 API 文件及黑箱測試驗證。
- clean-room 開發速度可能低於直接重用 Loki 實作。

## 替代方案

### 直接匯入 Loki 實作並接受 AGPL

否決。這會改變 Prism 的授權與散布義務，且把核心查詢路徑綁定到 Loki 內部實作。

### 不提供 Loki API 相容性

否決。此方案會破壞既有 Grafana logs 工作流程，與 ADR-001 的標準協定策略不符。
