# 應用用量觀測 — UO01–04

Owner繼續開發；在QV邊界驗收上補唯讀API及看板手動快照。這輪交付source／local證據，保持原runtime資源、授權期限與免費方案；部署另按現有發布流程固定候選與fresh前態。

| AC | 驗收 |
| --- | --- |
| UO-01 | GET /api/usage以commands:read、有效credential／grant及scope保護；單一SQL快照回總保留／滾動24h／active數、上限與剩餘量，無命令內容／身份／secret，不改業務表 |
| UO-02 | 上限與既有准入10000／1440／1一致，窗口created_at > now−24h；混入不同workspace/resource/generation/recipe的命令時403，避免以scope子集冒稱global可用額度；unknown仍計入active；provider與帳單未接入必須null/unknown |
| UO-03 | 看板明確按鈕手動讀取，不併入5秒poll；顯示快照時間、60秒後過期及失聯未確認；401/403清資料，舊session遲到結果不能回填；不因剩餘量大於零保證下次准入，不自動續權／刪除／加額度 |
| UO-04 | RED→GREEN、完整回歸、本機workerd/D1與Chromium、獨立審查及Git交付；區分local、live、provider、真人Access，完整AC08與mainline仍pending |

## API語義與範圍

schema cloudlab.usage.v1；observed_at為handler整秒時間，不是資料提交或帳單時間。scope指向caller的workspace/resource/recipe。application.retained、rolling_24h、active各含used/limit/remaining，remaining=max(0,limit−used)，即使歷史超限也不隱藏。rolling_24h另含window_start_exclusive。讀取單一SELECT的聚合快照，全庫命令都必須符合caller scope；無命令時全零只代表當次空庫。這是目前單節點部署的global准入政策，不是多租戶統計API。

provider.status=not_connected，各Workers請求、D1讀寫列數／儲存及billing欄位均null。缺少來源不能填0；這輪未嘗試查詢帳號analytics，不把未接線說成權限遭拒。命令額度不能推導供應商剩餘額度或零帳單。依[官方D1說明](https://developers.cloudflare.com/d1/observability/metrics-analytics/)與[Workers說明](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)（2026-10-30查閱），實際平台metrics另由provider analytics取得；後續採集須明示時間窗口、帳號／資源範圍及缺漏。

聚合可能掃描所有命令；HMAC讀取仍記nonce。使用按需按鈕避免增加既有輪詢查詢，沒有新counter寫入、索引或migration。讀取會有自身平台成本，並非免費保證。用量快照不包含所有D1表的儲存位元組，也不是全部HTTP/Cron用量；需要另期provider來源。

## 看板與保留政策

按鈕只在session已確認且具commands:read時啟用，單次不重試。60秒是依畫面估算伺服器時間的顯示過期門檻，不是跨請求一致性或容量預留。Bootstrap以monotonic測量完整請求耗時，超過10秒拒絕時鐘更新；對usage觀測時間容許向前1000＋ceil(耗時/1000)×1000毫秒（最多11秒），涵蓋整秒捨入及回應延遲。超出此界的future snapshot仍拒絕，顯示年齡最小0並列時間估計誤差；不是跨機器時鐘同步證明。錯誤時可保留標示過時的舊快照；401/403必須清掉，手動登入恢復後亦不自動重抓。數字用textContent呈現，不接收任意HTML。

保留上限滿時提示先備份與制定保留方案，不自動刪除歷史、跳過idempotency或改上限。具體retention／還原仍在[剩餘工作](remaining-work.md)，本輪不宣告完成。
