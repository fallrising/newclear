# M1 資料保留與恢復方案

本輪是FQ-03設計與現有行為驗證。**目前不自動刪除任何業務歷史。** 沒有DELETE工具、archive job、tombstone表、paid storage或新Cron；以下接替方案仍需實作／隔離還原證據，再對具體線上刪除取得批准。不能拿這份方案直接清D1或journal。

## 已實作的保留邊界

| 資料 | 目前行為／應保持的內容 | 後續清理前置條件 |
| --- | --- | --- |
| commands／idempotency | terminal、cancelled、expired、closed_unknown都保留；`principal_id, idem_key`唯一，原payload/body digest／identity／結果／決議與歷史不可隨時間消失。總保留10000筆到頂拒絕新ID，同ID仍可對帳 | 若移出熱庫，先有可靠的原key→原ID／payload conflict查詢與不可重播tombstone，並明確調整「保留總數」與歷史查詢契約。只匯出JSON後DELETE會失去dedupe，不能採用。 |
| artifact bytes | 位於commands.record；結果接收時間＋7天只控制下載，恰好到期回410，沒有物理刪除。digest與原觀測時間仍保留；command API不直接回artifact bytes | 可先設計只清已到期bytes的獨立策略；需保存digest、size、來源、期限與可驗證備份，保留terminal report重送／衝突語義。不能把到期當成功刪除，也不能拿重序列化JSON作原bytes備份。 |
| runner journal | executions的command id／identity digest／external_ref／started/completed/unknown與原結果永久保留至另有批准；unknown結案不改owner journal | 任何裁切須與control tombstone與runner防重做契約一致；缺row不能成為重新採集的理由。SQLite online backup或可靠停寫備份，不單獨copy主檔而漏WAL。 |
| schedules／firings | 保留原revision/due/outcome及命令關聯，包括skipped_quota／overlap／misfire；同due是終局，不補跑舊backlog | 刪firing可能使舊due看似未處理；需持久去重水位／tombstone及已界定的callback／恢復窗口。沒有這些之前不按日期刪除。 |
| grants／授權歷史 | 期限或撤銷不刪row；commands.submit_grant有外鍵。保留原revision／policy與操作收據，secrets不進公開備份 | 與既有command引用及稽核保全一起處理；保留資料不延長權限。沒有備份的舊revision不能假稱可完整重建。 |
| HMAC nonces | 目前認證流程在DB batch中刪`expires_at < now`的舊nonce，再插入本次nonce；這是既有抗重播窗口清理，與command歷史不同 | 不自行縮短窗口或把nonce裁切方案套用到commands/journal。無流量時不保證立即回收；被拒絕的已驗證請求仍可消耗nonce row。 |
| 備份／raw收據 | 私人持久目錄、最小權限、checksum與來源時間，包含schema、D1、journal及必要設定metadata。現在未設定自動到期刪除 | 定義備份輪替前，先保留至少一組實際還原驗證的基線與涵蓋未對帳工作的證據；檔案是否老舊不是刪除依據。憑證由既有私密機制保管，不放公開Git。 |

FQ的七天案例使用合成有效授權覆蓋時間旅行，原artifact bytes及獨立SHA-256、到期前一秒200／到期410、command整列／firings／同ID去重皆驗證不變；沒有延長真實授權。

## 容量與觀測

現有應用護欄為保留10000 commands、滾動24小時1440新commands及active1；完成／取消／unknown結案都不退還保留總數。15分鐘排程理論每天96個due，若每個due都接受新命令、沒有其他提交，從空庫約104.2天碰到10000；skipped due不新增command但仍可能累積firing。這只是應用筆數算術，沒有估計Workers／D1用量或費用，也不表示現有授權會維持104天。

監看[應用usage](usage-observation.md)的retained／remaining；8000與9000筆可作後續容量提醒設計，**目前沒有實作自動告警或調高額度**。artifact最多16384bytes，JSON內嵌轉義、metadata、索引、nonce、firings、journal和備份另占空間；不能用command筆數推斷D1剩餘空間。provider metrics/billing仍not_connected/null。

當保留總數到頂：保留現有對帳／讀取能力，停止盲換key重送。Cron會記skipped_quota且不補跑舊due；關停原Cron或切換歸檔策略前先具體評估並批准，避免以「沒有新任務」誤判「沒有平台呼叫」。

## 未來可批准的刪除流程

1. 固定schema／source／截止時間與具體候選ID，列出active、unknown及未對帳引用；第一版清理必須排除這些。closed_unknown仍有未知owner結果，不因active0即視為可刪。
2. 對原D1與journal建立受保護的備份／manifest／原bytes digest。兩者不是跨系統原子快照，以command與immutable identity逐筆對帳，不靠筆數相等。
3. 在無入口、排程停用的隔離目的地還原，驗schema、foreign key、原payload／artifact／result／tombstone，及same-key衝突、舊due不補跑、unknown不重做；按[XR](evidence/m1-restore-qualification.md)本機六案與[RX](evidence/m1-remote-restore.md)歷史unknown/started遠端資料還原分層驗證，活躍程序failover另驗。
4. 檢查備份可讀、還原成功與去重接替機制後，提出具名候選／精確CAS／影響與回退方案給owner。不得自動把「繼續開發」當作刪除批准。
5. 真正執行時需限制每批範圍及預期影響列數；回覆不明先對帳，不盲重試。恢復不能倒退授權、復活舊dispatch或覆蓋備份之後的新資料。

本輪只完成方案與既有邊界qualification；不把未實作的歸檔／tombstone、provider用量或完整AC-08記成通過。

## 拒絕稽核的獨立上限

[RA拒絕稽核](rejection-audit.md)的rejection_audit與commands分開，最多10000列，不自動DELETE／覆寫。容量滿時保留原證據、回應full；DB失敗回unavailable。無限期保存不是完整安全日誌保證；Access邊緣拒絕、5xx、傳輸失敗及程序中斷未必有列。歸檔／清理仍需另訂保全與批准，不能重置表假裝所有拒絕已收集。

[XR跨快照還原](evidence/m1-restore-qualification.md)補本機started／unknown／completed回報未達、缺journal、identity mismatch及較舊accepted D1六案；SQLite online backup包含已提交WAL。這不取代官方遠端還原或archive/tombstone gate，不新增清理或復活舊grant。

[RX遠端資料還原](evidence/m1-remote-restore.md)已完成官方export/import、42列及三journal備份對帳；expired grants原樣保留，未執行runner或新增授權。此證據不代表archive/tombstone、跨系統原子快照或活躍程序failover完成。
