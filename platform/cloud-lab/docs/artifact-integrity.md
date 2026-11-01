# DI：成果下載完整性

Owner繼續FQ後的下一項開發。補上看板下載的原bytes SHA-256核對與精確保存，沿用瀏覽器原生Web Crypto，不加依賴或擴大權限。實作與local驗證先行；原看板更新沿用先前已批准的原Worker／D1／Access／secrets／期限／免費方案範圍，若實際部署則另列live證據，不要求owner重測Safari或重開窗口。

| AC | 驗收 |
| --- | --- |
| DI-01 | 成果成功回覆以有界bytes讀取，最多16384bytes；一般JSON API／錯誤body維持32768bytes及既有Access失效、timeout、401/403語義。 |
| DI-02 | 從所選command可信metadata取得sha256:64小寫hex，Web Crypto核對原bytes；missing／malformed／mismatch或無crypto皆拒絕下載，無重試／新任務。 |
| DI-03 | 只有核對通過的原bytes可成為Blob下載；不得JSON.parse/stringify改寫。hash等待後仍檢查session、當前權限／期限與相同command digest；過期或舊session不能下載或破壞新session。 |
| DI-04 | 真RED→GREEN、完整回歸、真本機Chromium／workerd下載及篡改案例、獨立審查與正常PR交付；實際source/live邊界及失敗保留。 |

完整性只表示下載bytes符合已讀取metadata，不證明節點健康或metadata來源之外的真實性。既有validation failed成果仍可按原ACL／期限取回其原始診斷bytes；本輪不改owner結果／伺服器validation或資料保留。closed_unknown仍不可下載。結果digest或授權狀態在等待中改變時保守拒絕；不以client驗證取代服務端ACL。
