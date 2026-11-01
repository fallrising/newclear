# Observation rollout preparation — RP01–04

本輪準備SA／RO／IA的原Lab接入方案，不執行部署、續權或服務變更。舊看板批准只覆蓋資產及原期限；本方案增加Worker module與resident功能，驗證還需要新的短期機器授權，必須明確批准。

| AC | 準備驗收 |
| --- | --- |
| RP-01 | 固定已合併來源、Worker／資產／runner／IA依賴清單與hash，私人候選逐檔比對；不重新生成部署bundle或credential |
| RP-02 | 唯讀核對目前100% Worker version、DB binding、入口開關、Cron、grant／Access期限、active數及user service；歷史值不當成新觀察 |
| RP-03 | 明列更新順序、兩小時上限的待批窗口、每步回讀、停止及回退；部分成功／未知不自動重播；舊失效授權不因回退而復活 |
| RP-04 | 操作文件、公開證據、索引、獨立審查及正常Git交付；準備完成與真正部署／產品驗收分開 |

## 固定來源與候選

來源commit固定`f77fa595b62df47240e93cd9da181340d6d2514f`（PR724），已包含SA、RO及IA；部署準備文件的commit不會替換這個runtime pin。私人候選只拷貝Git blob的明列檔案，產生SHA256 manifest，檔案0600／目錄0700且不覆寫。沒有credential生成器、migration或grant seed執行。

- Worker：`index.mjs`、`auth.mjs`、`protocol.mjs`；新增自身授權查詢，不能套用舊看板operator的「modules不變」假設。
- Assets：已部署的三份HTML／CSS／JS逐byte保持；仍採worker-first。上傳時使用新assets completion，不重用舊短期JWT。
- Host：`adapters/node-health/runner.py`；原config、journal及鎖路徑不變，unit候選追加私人observation socket。IA工具另含`integrate_authorization.py`、`collect_authorization.py`、`authorization.py`、`prepare_deployment.py`四份依賴；最後一份僅被匯入使用私人檔案驗證，不能執行其bundle生成CLI。
- Rollback：保存本次實際100%前版deployment request、原unit bytes與runner hash；候選unit中的stop-at保持未綁定，批准後才按實際T0產生。缺失值不能作為可執行request。

## 執行前重新盤點

準備時的觀察見[證據](evidence/m1-observation-rollout-plan.md)，不是部署時的fresh snapshot。執行前重新讀取並保存部署／settings／version resources、custom domain、Access app與policies、指定service token、四個完整grant rows、commands／schedules／firings及user service。比較集合按穩定ID排序，不讀secret值進公開證據。

確認唯一原target、D1 binding、origin與audience、worker-first、workers.dev／preview off、Cron空、schedule disabled、active0，以及原journal無未對帳started／unknown。任何新部署、角色scope變更、撤權、token停用或leak標記、服務仍在運行、資源不一致均停止；不覆蓋別人的變更。先確認原主機Python與Linux /proc／socket／FLOCK條件。費用到Free上限就停，不能升級；未知帳單不是零帳單。

## 待批准的有界操作

建議一次批准以下完整窗口，避免只更新程式卻無法驗證。這仍是proposal，並非本輪已獲授權：

1. 實際執行時設定T0，最外層Access token最多到T0＋120分鐘；bot／runner的HMAC與D1 grant到T0＋110分鐘；resident停止新cycle的stop-at為T0＋100分鐘。只延長這兩個機器角色，保留原principal、scope、capabilities、credential ID／generation／secret；human與scheduler維持原過期期限。沒有金鑰輪替或長期續權。
2. 所有前置檢查完成後，私人保存具體UTC期限及精確request。Access使用原選定token的duration更新，保持client ID／secret version／name／enabled與policy不變，不使用refresh的隱含預設期限。PUT的duration不超過到T0＋120分鐘的剩餘秒數；API回讀expiry必須在本窗口內且足以覆蓋HMAC／grant。官方文件描述自訂duration延長，未在本環境驗證過期token的計算基準；不能假設精確等於T0＋120分鐘。若回讀超界、仍過期或不足，停止後續步驟並停用此token作失效補償，不能反覆試不同duration。API不支援這個窄更新時不得改成新token或policy放寬。依據：[Cloudflare service token更新與續期](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#renew-service-tokens)及連線API schema；refresh預設延長一年，不適用本方案。
3. 由原私人secret備份建立MACHINE_KEYS候選，只改bot／runner expires_at；逐欄比較其餘值，保存原值作回退，不輸出secret。Worker以固定modules與原assets發布，保留原DB、ACCESS_CONFIG、origin／audience、compatibility、assets routing及其他設定；只有已批准MACHINE_KEYS expiry變更。不能將整份歷史upload request直接重播。
4. 在兩個grant仍過期時完成程式／secret更新及回讀。再依新鮮snapshot產生bot／runner各自保留scope的CAS renewal：核對原revision／policy、revoked=0、active0及schedule off；逐筆回讀。兩個更新不是跨資源原子交易，任何部分成功都需記錄、停止並處理，不以重新seed覆蓋。
5. 保存原unit，將新runner安裝到新私人版本目錄，原journal／config不搬移。確認服務inactive與原鎖無owner後才換unit；啟動一次並啟用socket，poll仍30秒，不改enable／linger／開機政策。期限至少留10分鐘給驗收，否則中止，不自動延長。
6. 使用IA既有callback執行一次新採集：管理面前後10～12次、bot／runner self最多2次、resident最多1次。callback使用既有MCP授權與有界transport；成功manifest後再用IA status回讀。核對三個來源成功、scope及新期限吻合；API nonce寫入正常，不能宣稱完全無DB寫入。

本次驗證不提交commands、不啟用schedule／Cron。resident在恢復原dispatch權限後仍具有既有claim能力；因此要在啟動前後比對commands／firings與journal並保持active0，不能保證所有併發caller都無法提交。發現新工作先停止准入並對帳，不刪command／journal或盲目重跑。

## 回讀與回退

新version100%、原DB／入口／Access policy／assets及人類和scheduler grant相等；bot／runner僅有批准期限與grant revision差異。匿名入口仍拒絕，self及RO成功只是機器觀測，不等於真人Access驗收。保留`live_verified=false`，另以deployment／domain／settings的readback證據記錄實際版本與路由，不能讓IA自行冒稱它已驗route。

失敗先保留intent／response與實際狀態；timeout代表未知，先查deployment／token／grant／程序，不換label重試。回退動作須包含在此次批准：停止本次runner並回讀退出、還原原unit但保持inactive；回指前版100%並核對其settings／secret版本適用性。若token／MACHINE_KEYS／grant有成功續權，明確撤回本次延長，不把舊revision寫回：grant以CAS寫回原過期policy並再遞增revision，secret恢復原已過期metadata；Access若不能精確還原過去expiry，停用同一token作失效補償並記錄與原enabled狀態的差異，不改policy。任何競爭或無法確定回退效果時停止並交由owner決定。

成功驗證後停止本次resident並保留unit／journal／snapshot與receipts；機器授權按批准期限自然到期，不自動續權。stop-at是cycle准入期限，不是硬中斷正在進行的cycle，故仍需回讀實際退出。這是短期接入驗證，不是常態運維或完整AC06–08完成。

## 批准與缺口

本輪交付可審查的固定source候選、前版回退request、unit模板與操作矩陣；尚未生成含新到期值的secret/request，也未呼叫任何mutation。批准時接受相對T0的有界期限，執行時把T0與全部UTC值持久保存再進行；若要換target、角色、scope、時間上限或付費方案，需重新確定範圍。

## 後續實際接入 — 2026-10-29

Owner後續已明確批准RP有界方案並執行；[OL實際證據](evidence/m1-observation-live.md)記錄部署、兩個機器短期期限、真實整合與驗證後停止。上文保留各原階段範圍與限制；這次不是常態服務、human／scheduler續權或完整主線驗收，沒有自然到期觀察或回退演練。
