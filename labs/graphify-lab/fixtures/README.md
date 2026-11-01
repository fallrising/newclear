# 可人工核對的 Graphify 輸入

這些程式碼由本 lab 建立，使用真實 Graphify AST parser／CLI 建圖；不是預製 graph 或 parser mock。

`python-shop` 的已知呼叫鏈是 `checkout → submit_order → apply_discount`，`test_submit_order → submit_order` 是測試呼叫線索。`unrelated_healthcheck` 不參與該呼叫鏈；`legacy_total` 在 run 專用副本中改名為 `shipping_quote`，檢驗增量更新不殘留舊節點。每次 suite 重新複製原始 fixture。

`ts-consumer` 的 `CheckoutApp.run()` 使用注入的 `InvoiceClient.issue()`；此型別只在 `ts-sdk` 宣告。兩邊分別建圖再 merge，應解析一條跨 repo、`INFERRED` 的 calls 邊。`IssueTracker.issue()` 的同名方法不得成為目標。加入 `ts-duplicate` 的第二個 `InvoiceClient` 後，應拒絕把歧義變成確定的呼叫邊。TypeScript 輸入專供靜態分析，沒有安裝虛構的 `@lab/invoice-sdk` 套件，也不宣稱完成其建置或 runtime 整合。

原生 HTML export 僅驗證檔案與嵌入圖資料；其 vis-network 腳本來自 unpkg CDN，這輪不宣稱已驗證瀏覽器互動或離線可用性。所有 fixture 的內容 SHA256 寫入報告，用來區分上游意外繼承的外層 Git HEAD 與實際被解析內容。
