# DI：成果下載完整性證據

## Source與local結果

[DI01–04](../artifact-integrity.md)完成看板有界raw bytes讀取、原SHA-256核對與exact Blob。Worker／API／runner／schema不變，沒有套件／付費／權限新增。這份記錄是source/local gate；原看板實際更新採固定候選、原設定／期限保全及獨立live收據，最新交付／部署狀態見[任務板T0032](../tasks/BOARD.md)。不將本機成功冒充線上真人驗收。

成功artifact回覆最多16384bytes；一般API與error body仍32768bytes，沿用Access HTML／redirect、401/403、request id與timeout。成果回覆必須application/json，原body不parse／重排；validation failed的既有診斷bytes也可在原ACL／期限內核對保存，不因此改變健康結論。

選定command metadata必須sha256:64小寫hex。Web Crypto核對前先複製bytes，避免await期間來源buffer被改；缺metadata／錯digest／超限／crypto不可用都不產生下載。hash完成後再次檢查session、synced、同command的當前digest、權限與expiry；舊session成功或錯誤不能影響已恢復的新session。metadata來源與服務端ACL仍是信任邊界，digest一致不等於節點healthy。

## 實際驗證

- DI-red：11個新增案例全部如預期失敗，包含原client回JSON而非bytes、原Blob重新序列化、錯digest仍下載及不存在hash等待護欄；原RED保留。
- DI-green：42項看板案例通過。再補16384bytes等號／非JSON診斷原bytes、錯media type取消與Buffer在hash等待中改動三案後，完整回歸`python3 platform/cloud-lab/tools/check.py`為121Node＋304Python＝425tests，無fail／skip。Node24.14.0／Python3.13.5，實際loopback／Unix socket／子程序；未聲稱本機Python3.11。
- DI1：既有Chromium154.0.8037.57與Miniflare5.20261019.2-beta跑真local workerd/D1、合成JWT及實際Python collector，15組browser checks／104API calls、errors空。下載檔逐byte等於collector artifact且獨立SHA-256符合metadata；gateway刻意加一個空白後，頁面顯示完整性失敗、無新增下載且原檔不變。原auth／retry／stale／usage／unknown與viewport案例亦通過。見[實際browser收據](m1-artifact-integrity-browser.json)。
- browser收據三份asset hash均與目前source一致；瀏覽器／套件及library使用已存在安裝，未新增依賴。沒有開私人網站、真人Access或請owner重測Safari，viewport不等於實體手機。

所有測試使用共用launcher；DI-red／green／full日誌及DI1 browser/checks/screenshots/download留在各task保護evidence。首次DI-browser在真正browser檢查前因Chromium Unix socket path太長失敗，stderr明確記錄，CDP回ECONNRESET；改成同一短workspace中的短task ID DI1後通過，未清理舊證據／放寬程序安全／改產品測試oracle。既有GLib／DBus診斷不是產品JS錯誤，保留原stderr。

## 審查與限制

[T857獨立審查](../../../../.team/reports/T-857.md)最終ACCEPT，已核對實際425tests／DI1 browser及asset hash；50project contracts／8llms／task／diff／378相對連結檢查通過。主導接受source/local gate，部署與Git結果另外核對。此修正補F10的client原bytes完整性缺口；持久拒絕audit、事件／通知語義、unknown/in-flight restore、provider用量與歸檔仍未完成。授權或成果在server讀取後的未知遠端變化，不由client hash自動偵測；client只對已觀測的session／metadata變化作保守拒絕。
