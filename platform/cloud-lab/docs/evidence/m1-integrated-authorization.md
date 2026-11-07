# Integrated authorization evidence — 2026-10-28

[IA01–04](../integrated-authorization.md)整合管理面AS、機器自身SA及resident程序RO來源。這是source與隔離本機驗證；本輪沒有讀取原Lab私人狀態、沒有雲端部署、服務重啟或續權。

## 驗證與來源

共用launcher執行`python3 platform/cloud-lab/tools/check.py`，IA-regression通過42Node與168Python；其後新增4項負向案例，IA-added-negatives的21項整合Python測試全部通過。IA-final-regression其後通過42Node＋172Python＝214tests；審查修正後IA-binding-green再次通過214tests，最終status未知層斷言由IA-status-negatives的21項測試確認。

- AS在self／resident前後各讀取一次，對照D1／settings投影、選定Access metadata及client binding。測試涵蓋revision、token及config漂移；Worker宣告origin／audience或Access client不符時，尚未送出任何self憑證請求即停止。
- self使用既有固定路由與有界transport，核對D1 grant identity／revision／scope／期限。缺失來源、401／403或無效回應留下null與固定outcome，不從舊bundle補值。
- resident只附加在已驗證的runner self上，且兩者須對上同一config digest。過舊resident、不同config、超出configured stop等資料不能組成成功快照。
- 最早來源時間保留；self回應舊100秒時，不會被重新標成採集完成時間。逆行或超過120秒窗口拒絕；AL仍依300秒新鮮度判斷，live_verified=false。
- 私人0700目錄／0600檔案，manifest最後寫入；部分失敗沒有完成標記。快照或provenance即使只追加空白，也無法通過檔案hash核對。既有目錄不覆寫，checkout與symlink輸入在provider呼叫前拒絕。
- 真實本機整合以既有Worker HTTP/HMAC與SQLite grant資料，串接Python實際Unix socket、kernel peer／FLOCK／config觀測，再寫出並讀回快照。grants／commands／schedules相等；只新增2筆防重播nonce，未建立runner journal或派工。輸出不含合成secret、client ID、origin或私人fixture路徑。

管理envelope及Access token都是合成資料，SQLite讀取固定AS SELECT；未接真實Cloudflare。Loopback HTTP由既有harness映射HTTPS後交給未修改的Worker；合成management origin只對應loopback transport。測試只patch Git祖先guard以適應launcher位置，其他owner／mode／no-follow及HTTP／kernel驗證保留。另有未patch checkout拒絕測試；不把fixture當作route或Access policy驗證。

T830初次審查REWORK指出：沒有角色config時，未經client binding的Access資料仍被保留。IA-binding-red在全部缺省與runner-only兩個案例重現失敗；修正為對所有machine角色清除未綁定Access層。初次REWORK與RED保留；[T830複審](../../../../.team/reports/T-830.md)檢查修正、214GREEN及最後21項status斷言後ACCEPT。Reviewer未自行執行測試或讀取live狀態，lead核對實際diff及證據。

## 原始失敗與限制

IA-red初始17項測試因實作缺失出現19個errors，IA-unit實作後17項全過。IA-integration首次4項中3過1失敗：fixture將Worker PUBLIC_ORIGIN也改成HTTP，觸發原HTTPS准入拒絕。修正fixture，保留既有HTTPS映射及正式Worker檢查；後續整合通過。原始log保存在共用workspace相應task的protected evidence，沒有改寫失敗。

Node SQLite experimental warning與既有Python SQLite ResourceWarning保留；實際Python版本為3.13.5，沒有宣稱Python3.11實測。Source callback由呼叫端負責transport期限；前後一致不能證明中間無瞬時變更，hash不能抵抗可重寫全部私人檔案的owner。Route、部署版本、Access policy與真人session均未驗證。

## 交付與後續

[任務板](../tasks/BOARD.md)記錄實際Git／CI／合併回讀；完整主線AC06–08仍pending，沒有usable tag。下一步先準備具體target、期限、來源版本、回讀及回退計畫，再依授權進行受控部署與整合採集；不能為填滿看板而自動續權、啟動Cron或增加付費方案。
