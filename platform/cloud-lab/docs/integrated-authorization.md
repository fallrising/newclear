# Integrated authorization observation — IA01–04

整合AS管理面metadata、SA機器自身HMAC metadata及RO實際resident期限。只產生私人AL snapshot與來源紀錄；不部署、不續權、不套用SQL或啟動原服務。本輪沿用Python標準庫與既有Worker／runner來源。

| AC | 驗收 |
| --- | --- |
| IA-01 | 在SA／RO前後各執行一次AS，核對target、D1／settings投影及選定Access metadata；有效self回應的grant id／principal／revision／期限／scope必須與AS一致 |
| IA-02 | Config對上Worker宣告的PUBLIC_ORIGIN／AUDIENCE；選定token的client_id與config匹配才附加Access層；RO與SA綁定同一載入config digest，前後config不漂移 |
| IA-03 | 每層有來源時間／digest／結果；缺失或拒絕保持unknown，互相衝突整次拒絕；最早觀察時間不刷新，總採集窗口有界，AL狀態維持live_verified=false |
| IA-04 | 私人0700／0600、manifest最後寫入及完整性驗證的status入口；負向／漂移／真實本機HTTP與Unix socket整合、回歸與獨立審查 |

## 操作介面

`tools/integrate_authorization.py`提供`collect(profile, request, config_paths=..., resident_socket=...)`與`write_collection(profile_path, output_directory, request, ...)`，profile沿用AS v1。config_paths只接受bot／runner角色的私人檔案，可缺省；缺省角色不做self請求。SA使用固定POST／api／authorization／self及既有有界transport，RO使用既有kernel／config／lock驗證。MCP request callback須自行限制transport；不新增OAuth登入方式或靜態token。

前後AS共10～12次固定管理請求，最多2次self查詢及1次resident查詢，無retry。Self查詢會正常寫防重播nonce；沒有grant／command／schedule業務變更。對AS比較排除觀察時間，不排除grant或token欄位漂移。自訂測試adapter不是live來源證明。

## 來源關聯與失敗

當提供config時，先驗證其private boundary與scope，管理面settings的PUBLIC_ORIGIN／AUDIENCE必須匹配再送self請求；這驗證Worker設定，沒有獨立驗證實際domain route／部署版本或Access policy。這些限制寫入provenance，不能據此聲稱真人登入成功。

SA回傳自身metadata的scope／grant revision／principal／not_before／expires_at必須與D1匹配；HMAC id與generation由既有SA驗證匹配config。選定Access token client_id若缺少，該角色Access層保留未知；若與已提供config衝突則整次失敗。client_id／secret不進輸出。

RO只有在runner self身份與D1已對齊、其config digest與RO實際載入digest一致時才附加stop期限。未提供config／socket、過期401／403或source拒絕會留下固定reason與null，不讀舊bundle補值。已知有效來源互相矛盾、config在採集中改變或前後AS不一致，整次失敗且沒有完成manifest。

最早的本機請求起始／server觀察時間作snapshot observed_at；總窗口最多120秒，不能把舊資料改標新時間。超過300秒後status依AL保持過舊；有效期限仍只是觀測，不保證之後不變。各層期限齊全不表示Access policy、route或真人session已驗證，live_verified仍false。

## 私人輸出與status

新建私人目錄含snapshot.json、provenance.json及最後寫入的manifest.json，目錄0700／檔案0600，拒絕覆寫、symlink及Git checkout。半成品保留，不自動重播或清理。

`python3 tools/integrate_authorization.py status --collection /private/observation`核對manifest及兩個檔案SHA256再計算AL狀態，stdout只含role／狀態／期限與來源結果。Hash是本機完整性核對，不是抵抗可改寫全部私人檔案的owner之簽章。直接使用舊AL snapshot CLI仍不驗證sidecar，整合入口不能被描述為已改變AL既有介面。

本輪僅source與合成／本機整合驗收，SA與RO尚未裝到原Lab；不為了採集而自動部署或延長已過期憑證。後續才準備指定target／期限的受控切換。

實作與測試紀錄見[本輪證據](evidence/m1-integrated-authorization.md)。整合fixture的管理envelope為合成資料，loopback origin只代表測試transport；既有harness將請求映射為HTTPS交給未修改的Worker。沒有藉由fixture驗證真實Cloudflare settings／routing。
