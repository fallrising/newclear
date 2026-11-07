# Read-only authorization collection — AS01–04

Owner要求接續開發真實資料唯讀採集。本輪只讀原選定Lab的Worker settings、D1 grant／active count／schedule count及明確指定的Access service-token metadata；不新增token、不讀取secret值、不續權、不啟動服務或Cron。

| AC | 驗收 |
| --- | --- |
| AS-01 | Profile固定account／worker／DB／四個role grant／兩個機器role token；請求限固定GET與固定SELECT，驗證Worker DB綁定，沒有任意URL／SQL／list掃描／retry |
| AS-02 | 保存每次回讀的時間／endpoint種類／response digest；採集前後settings與D1投影一致，最早時間作snapshot observed_at；過慢／逆時／任一HTTP或D1子結果失敗則拒絕輸出 |
| AS-03 | 輸出AL v1 snapshot及provenance，不包含raw response／client ID／secret；HMAC、runner stop及真人session無當前權威來源時明示未知，不讀舊bundle補值 |
| AS-04 | 私人profile／snapshot／sidecar的0600／0700、checkout及symlink邊界；合成請求與失敗／漂移／來源時間測試、獨立審查、原Lab唯讀實證 |

## 介面與責任

`tools/collect_authorization.py`提供`collect(profile, request, clock=...)`及`write_collection(profile_path, output_directory, request, clock=...)`。由現有Cloudflare MCP操作端提供`request(dict)` callback，返回Cloudflare envelope；操作端管理既有OAuth與有界transport timeout，不新增靜態API token，也不把Codex credential-store格式寫入產品程式。這是有live adapter介面的採集library，不是假裝可獨立登入Cloudflare的CLI。

Profile使用`cloudlab.authorization-source.v1`，欄位為account_id、target(worker_name／database_id)、grant_ids(human／bot／runner／scheduler)及service_token_ids(bot／runner)。所有值固定驗證；metadata與profile屬私人資料，公開repo僅有合成example。role→grant及role→token映射由operator指定，不宣稱已從Worker secret或Access policy重新驗證此關聯。

最多6次請求：前settings、前D1、最多兩個distinct token GET、後D1、後settings（共享token只讀一次，共5次）。D1只執行固定三個SELECT；最多讀5個grant以偵測超出此四role模型的資料，非任意查詢工具。一次採集時間最多120秒；request callback另須有單次transport timeout，函式不能中斷阻塞中的callback。前後相等不是原子快照或持續不變保證；套用計畫仍需原SQL CAS及owner批准。

Worker settings只用DB binding驗證target，並比較binding metadata及設定digest。snapshot grant／active／schedule來自前後一致的D1結果；Access服務token只投影id、enabled→revoked及expires_at，跨來源時間各自保留。enabled缺漏不能猜true，缺失／權限錯誤不能寫成fresh完整snapshot。

HMAC expiry／revocation無法由秘密名稱回讀，所以credential=null；runner_stop_at=null，因未採集當前runner process。service-token metadata不是外層Access policy或端到端登入證明。AL的live_verified仍false，狀態可能顯示已知expired且deadline_complete=false。真人／scheduler不使用機器token欄位。

## 持久輸出與後續

輸出新建repo外0700目錄，內含snapshot.json、provenance.json及最後寫入的manifest.json，各0600。既有目錄不覆寫；中途失敗保留不完整目錄，不當作成功，不自動清理或換名重播。manifest綁定兩個檔案digest；status／plan明確使用snapshot.json，provenance供人審閱，AL v1不自動驗證sidecar。

採集不代表所有credential完整，也不產生預設續期日。operator確認來源與缺口後，才能依具體批准期限使用既有plan。完整日用切換、HMAC權威metadata方案、runner程序觀測、輪替執行器、排程及配額仍待後續開發。

## 操作端接法

[合成profile](../examples/authorization-source.json)只說明欄位，不是現有Lab設定。操作端以importlib載入`tools/collect_authorization.py`，傳入既有已授權的Cloudflare request adapter，呼叫`write_collection(private_profile, new_private_directory, request)`。Adapter只轉送函式產生的固定請求，須限制單次timeout／response大小並將原始receipts保存在私人目錄；不將OAuth、provider exception或raw response印到聊天／公開log。

成功後，以`authorization.py status --snapshot <collection>/snapshot.json`查看結果；只有在owner選定具體期限並讀取來源缺口後才準備plan。Profile／snapshot／provenance／manifest均保留私人，公開證據僅寫非識別的計數、通過／失敗與限制。原始token metadata的client_id、name及任何非白名單欄位不進snapshot；時間的小數秒向下取整，不延長有效期。
