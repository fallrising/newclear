# UR：以未知結果結案

## 範圍與驗收

解決原node-health journal已持久記為unknown、control plane持續reconciling而長期佔槽的情形。本輪只交付source／隔離驗證及可審閱的操作方案；不直接處置線上命令、不續權、不新增資源或付費。沒有自動timeout解鎖，不把未知標成成功或已停止。

| AC | 驗收 |
| --- | --- |
| UR-01 | 離線CLI從新鮮原command row及owner journal證據，產生需批准的單筆結案計畫；只接受固定唯讀node-health、過execution deadline、journal unknown且身份一致。 |
| UR-02 | parameterized SQL對id／revision／完整record／body與active做CAS，新增明確operator決議、保留原result null及身份／歷史；重播或漂移不更新，不清journal，不退還總數／24h額度。 |
| UR-03 | Worker將closed_unknown視為terminal、拒絕晚到report；同ID重送保留原結案，後續新API／Cron可使用已釋放槽；看板與bot誠實顯示未知結案，沒有新的模型可用處置工具。 |
| UR-04 | RED/GREEN、真實本機SQLite跨Python／Worker整合、競爭／保全／顯示回歸、獨立審查與正常PR交付；不將本機成功當作live恢復。 |

## 邊界與介面

`tools/resolve_unknown.py --snapshot <private.json> --output <private-plan.json> --operator <operator-id> --resolution-id <uuid>`只生成計畫，不連雲端、不開journal、不執行SQL。輸入包含schema_version=cloudlab.unknown-resolution.v1、observed_at、target(worker_name/database_id)、command（完整D1 row）、journal(command_id/identity_digest/state/result)。由可信operator唯讀採集原D1與SQLite journal；snapshot及輸出0600、Git外、限32KiB。journal不是任意口頭斷言：實際操作前需以原config／journal identity重採核對，保存原始收據；離線工具本身不能證明來源真實。

唯一action為close_unknown，固定reason=operator_accepts_unknown。record.delivery改closed_unknown、active=0，新增resolution{id,action,reason,decided_by,decided_at,journal_sha256}；原result保持null，原attempt/external_ref/command/cancel_requested不改，revision單調增加。這是控制面准入決議，不是owner執行結果或停止證據。拒絕started、completed、成功artifact、未過期限、跨identity／不支援recipe、過期snapshot；計畫最長60秒且不超過snapshot300秒。SQL本身也檢查有效期限；exact CAS使同一計畫最多一次。

新Worker拒絕closed_unknown的任何runner report，cancel返回原結案而不改審計，view不因lease過期回到reconciling。bot既有state=unknown加code=RECONCILIATION_CLOSED，verified=false，不需要擴大MCP狀態或模型權限。看板只展示「已結案，結果仍未知」並禁用取消，不新增一鍵處置。

## 實際操作前置條件

先備份原command／journal及資源設定，取得owner對原命令結案的具體批准；部署已驗證的新Worker與相容bot（需要啟用bot時），先確認active version及module bytes支援closed_unknown。**舊Worker不理解此terminal，不能在結案後直接回退到舊程式。** 為避免舊版本／在途report競爭，實際操作方案須短暫暫停原runner、確認程序停止且無在途HTTP後，fresh產生並一次執行CAS，再回讀決議及active0，恢復原service/config/journal與原截止。這不是重跑舊命令；後續只有新id可新採集。此短暫服務暫停及單筆結案須在具體live方案中明示，不能藉source開發批准直接執行。

SQL回覆未知先按resolution id／row回讀，不重播。CAS0不代表成功；fresh對帳漂移，不能強制UPDATE或清歷史。已有成功結果或不同決議則停止。新Cron恢復後驗一筆新due即可，不要求owner重複瀏覽器檢查。原Safari功能驗證沿用；Console asset hash依owner指示取消，未跑不記通過。

## 後續已批准的線上操作

Owner具體批准後，ULR01–04已完成[原命令結案與新Cron成功驗證](evidence/m1-unknown-resolution-live.md)。本頁前文的source-only範圍為UR歷史里程碑；後續操作保留原未知結果、所有歷史與期限，沒有把source驗證當成live證據。
