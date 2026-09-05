# ADR-003：Metrics 原字串下推，Logs 與 Traces 使用結構化 IR

## 狀態

Accepted

## 決策

- Metrics 查詢保留原始 PromQL 字串。後端宣告支援時直接下推；否則由 Prism 使用 upstream PromQL engine 執行 fallback。
- Logs 與 Traces 查詢解析為 Prism 自有的結構化中介表示（IR），再由後端轉譯或由 Prism 執行。

## 背景

PromQL、LogQL 與 trace 查詢的成熟度、語意複雜度、後端支援程度及授權條件並不相同。硬把三種查詢壓成同一種表示法，會犧牲既有引擎相容性，或讓 IR 複雜到等同重新定義所有語言。

## 理由

- PromQL 語意複雜且已有可重用的 upstream engine；保留原字串也最適合具原生 PromQL 能力的後端。
- 結構化 Logs/Traces IR 能讓非 Loki、非 Jaeger 後端安全轉譯，不需要理解完整原始查詢字串。
- 分離策略讓每個訊號採取最符合其生態系與授權限制的實作方式。
- capability discovery 可以在下推與 fallback 之間做顯式、可測試的選擇。

## 後果

- Metrics 下推路徑與 fallback 路徑必須維持相同查詢語意，並以 differential test 驗證。
- Logs/Traces IR 必須版本化，未知節點必須明確拒絕，不能靜默忽略。
- 查詢規劃器需依後端能力拆分執行，並對不支援的組合提供清楚錯誤。
- 三種訊號不會共享完全相同的查詢管線，增加少量內部架構差異。

## 替代方案

### 三種訊號都使用單一結構化 IR

否決。要完整承載 PromQL 會大幅擴張 IR 與相容性負擔，並重複 upstream engine 已解決的工作。

### 三種訊號都傳遞原始查詢字串

否決。多數儲存後端無法安全理解或轉譯任意 LogQL/trace 查詢，且 LogQL 的實作還有 ADR-004 所述的 clean-room 限制。
