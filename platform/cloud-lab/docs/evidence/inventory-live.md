# 盤點看板上線（ML）

Owner明確批准既有[上線方案](../inventory-activation.md)。2026-11-02T14:12:48Z fresh查核與候選準備基準一致；14:16:59Z完成回讀。僅更新原部署，不新增服務、token、Cron或付費方案。

## 實際結果

| AC | 操作與證據 | 結果 |
| --- | --- | --- |
| ML-01 | 候選9檔逐byte吻合已合併來源；原Worker、settings、Access、grants、schema與已批准基準一致，原multipart備份／回退保留 | passed |
| ML-02 | 原D1套0003.sql；重新MCP收集並由原producer離線轉換；參數化且僅workspace不存在時匯入，changes1；canonical body／digest／times回讀一致 | passed |
| ML-03 | 4份資產manifest、實際上傳4份；5個ES modules下載後逐byte一致，新版本100%；keep_bindings繼承2個secret_text，其他settings／bindings保留；human CAS changes1、revision3精確回讀 | passed |
| ML-04 | Access app／policies／1h session、workers.dev／preview停用、Cron／schedule policy、其他3grants與期限不變；資產先經Worker；匿名根頁及inventory API均302到Access登入 | passed |

首報observed_at為2026-11-02T14:13:12Z，received_at為14:14:21Z；canonical大小4324bytes。觀測到2zones／4Workers／4Worker domains／5Access apps；Pages及Tunnels403，仍unknown。原desired未修改，期望項未觀測到不表示資源已刪除。source為原producer SHA256 `1bcb0c3acf194966418ca00da9aff3353356cd6c4fdbbf67a9e0bc165fa6f753`，並非provider簽章。私人資源明細、帳號、網域、JWT及原設定不進公開Git。

人類capabilities僅commands:read、artifact:read、inventory:read、inventory:publish，有效至2026-12-02T12:00:00Z；保留原principal／workspace／resource／recipe／not_before／限額。沒有node-submit或取消權。bot仍過期；runner grant截止2026-11-05T07:34:26Z、scheduler grant截止07:24:26Z、schedule政策截止07:24:25Z；均未續期。沒有固定人工驗證窗口或手機測試要求。

## 驗證與限制

本次是原部署與管理面保存／回讀，不冒充真人Access登入、瀏覽器新上線驗收或完整雲lab。前輪已通過producer48Python＋8Node、consumer471測試與真報告本機workerd／D1五項閉環；本輪沒有更改產品程式，因此不重做相同全套。公開文件檢查、獨立證據review與交付見[T869](../../../../.team/reports/T-869.md)。

保留一次驗證器失敗：上傳後下載的source實際為raw multipart，首次假設{result:...}造成TypeError。修正解析既有receipt後5modules一致；沒有重播發布或放寬檢查。其他工具查核失敗（環境無rg、錯用根BOARD路徑）只影響本地查找，已使用現有路徑／工具完成。

回退按原批准方案恢復保存的舊Worker版本100%，保留新表和首報；human回復原policy須新CAS revision，不倒退revision。secret只證明binding繼承，沒有逐值讀回。實際provider帳單未查，不宣稱零帳單；未申請任何付費升級。完整mainline仍incomplete、usable_tag仍none。
