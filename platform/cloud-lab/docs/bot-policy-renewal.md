# Explicit bot policy renewal — BR01–04

Owner繼續開發明確續租及啟用準備。本輪source／local：補本機離線preview／顯式續租、歷史保留與重試恢復，不操作live安裝／Grok／Cloudflare授權或付費。沿用[BP政策](bot-policy.md)的固定node-health、24小時／24新ID／240call硬上限與原config綁定。

| AC | 驗收 |
| --- | --- |
| BR-01 | 可信CLI明確提供舊／新私人政策；dry-run可在到期前預覽，新窗口不重疊且不晚於新authority_until；preview不寫配額、不送HTTP |
| BR-02 | 舊租期到期後才可執行，digest CAS及單一SQLite交易歸檔舊policy／ledger／reservations並啟動新期；原requests bytes及ACK不變 |
| BR-03 | 同候選重試可辨認已套用，不能再次補額度；失敗原子回復、併發FLOCK、時鐘回退拒絕；跨租期間隔沿用，未知同ID不換命令 |
| BR-04 | RGR、實際CLI／MCP／HTTP跨期恢復、完整回歸與獨立審查、文件及Git交付；source／local與live分開 |

## 核心語義

新政策使用另一個owner-only檔案，完整config digest必須與舊政策相同。新not_before不得早於舊expires_at，<=24h且<=新authority_until。額度／間隔可在既有硬上限內明確設定；用完額度不能提前續租。authority_until仍是operator以fresh bot HMAC／grant／Access／runner實際stop取最小值的輸入，離線preview不宣稱已查證遠端授權。

原requests表完全保留，不移除payload、digest或command_id。明確續租先將舊policy、整份計數／時間ledger及該期新ID reservations存入append-only續租receipt；同交易清空活動reservation索引及將活動calls歸零，舊資料存在receipt中。保留last_call、last_new與high_water，因此跨期不能連續突發、回退時間或重用已到期政策。既有saved request的同ID恢復只計新期call；舊期僅bootstrap失敗、未產生payload的ID在新期首次嘗試仍占新期名額。

舊digest是CAS前態；新digest是目的態。已套用後同一對指令重跑回already_applied，不改計數／歷史；非dry-run仍保存最大觀測時間。已經再續到其他政策時，舊指令拒絕；不能回復舊期、改寫receipt或重播補額度。歷史receipt與切換在SQLite FULL交易下提交；commit後回覆遺失由原指令重讀對帳。FLOCK涵蓋preview／續租及現有bridge call，不等待鎖、不自動重試。

舊host仍帶舊政策時會因digest不符而停止；收到續租成功／already_applied後，operator另行把host切到新政策路徑。兩個檔案及原state均保留。此CLI不安裝、不改host、不續雲端授權；沒有定時續租或模型可用的續租工具。

## 操作與恢復

1. 保留原state、原policy及已固定source；以原config產生另一份新policy（同schema）。以fresh來源取最早上限，確認new not_before >= old expires_at及新期<=24h；盤點未知request並保留其ID，不為它們產生新ID。
2. 先執行離線preview，檢查old/new digest、renewable_at、expires_at、authority_until、limits、舊calls／新ID數。這是候選與本機帳本讀取，不能證明雲端已續權；preview可能在真正切換前過時，執行時會重新檢查。
3. 到期後執行同一組明確舊／新政策。失敗保留資料，先讀回對帳。若回覆遺失，只重跑原指令；already_applied表示這一對切換曾成功，不表示額度全新、目前授權有效或其他工作已完成。
4. 確認回執後另行更新host啟動參數至新policy並重啟MCP；用原request_id查詢／恢復，不另建ID猜測重做。原host未切換時context mismatch是預期停止。不要在兩個步驟之間改寫原policy或回退DB。

```sh
python3 tools/bot_bridge.py --config /private/bot.json --state-dir /private/bot-state --policy /private/policy-old.json --renew-policy --next-policy /private/policy-next.json --dry-run
python3 tools/bot_bridge.py --config /private/bot.json --state-dir /private/bot-state --policy /private/policy-old.json --renew-policy --next-policy /private/policy-next.json
```

`--renew-policy`與`--initialize-policy`互斥；`--next-policy`／`--dry-run`僅能跟renew使用。MCP仍只有原check／status兩個工具，完全不暴露renew。返回planned／renewed／already_applied時exit0；格式、時鐘、state或時序錯誤exit2。沒有自動等待或重試。

| code | 意義 |
| --- | --- |
| INVALID_POLICY_RENEWAL | 不同candidate要求、窗口重疊或CLI組合錯誤 |
| POLICY_RENEWAL_TOO_EARLY | 舊期尚未到期；即使配額用完也不能重置 |
| POLICY_NOT_STARTED / POLICY_EXPIRED | 新期還沒開始／已到期，不能套用 |
| POLICY_CONTEXT_MISMATCH | 目前digest不是預期前態／已套用的目的態，或config不匹配 |
| POLICY_CLOCK_ROLLBACK | 觀測時間早於持久high_water，停止切換 |
| STATE_BUSY / STATE_CORRUPT / CONFIG_OR_STATE_UNAVAILABLE | 鎖、歷史／帳本或儲存異常；保留原state停止 |

`bot_policy_renewals`只由此程式INSERT，不修改既有receipt；每筆有old/new digest唯一鍵、完整receipt及SHA256。SQLite REAL時間在receipt用float.hex文字保存，避免失去小數精度，同時符合既有strict JSON只接受整數的規則。活動reservation索引清空不等於刪歷史；該期所有ID已在同一交易receipt保留。requests表不參與UPDATE／DELETE。

失敗交易會回滾歷史與活動額度切換；已觀測的high_water獨立先commit，因此續租失敗也不能靠時鐘回退重開舊期。dry-run（含已套用的preview）為讀取路徑，不更新觀測時間或配額。非dry-run的already_applied保存最大觀測時間，包含新期到期後的重跑，但不改quota／requests／歷史；避免接著時鐘回退重新准入。這些回執不給新I/O許可，真正bridge准入仍重驗政策與時鐘。

## 啟用邊界

本輪未安裝候選，也未改原Grok參數或Cloudflare。後續第一次啟用需固定已合併source、fresh原state／bot self／runner resident／Access等證據及具體期限，保留原request。只允許原bot在既有runner與Access上限內續權；不擴scope、輪替secret、延長其他角色或新增付費。原HL資產session500仍是分開的open任務。
