# 盤點看板上線提案（MC）

狀態：候選準備中／待owner批准，尚未發布或改權限。沿用原受Access保護的Cloud Lab Worker、D1與Workers Free，不新增服務、token、Cron或付費方案。

## 唯讀查核與候選

2026-11-02T12:21:57Z查核：原Worker為單一版本100%流量；workers.dev及preview均關閉，資產先經Worker。Access session為1小時，既有兩種policy保留。D1有292筆命令、active0；15分鐘排程仍啟用。人類／bot授權已到期；runner grant截止2026-11-05T07:34:26Z、scheduler grant截止07:24:26Z，schedule設定截止07:24:25Z。原D1尚無inventory_snapshots表。這是具名觀測，不保證執行時未變動。

MCP在2026-11-02T12:31:45Z～12:31:50Z取得2zones／4Workers／4Worker domains／5Access apps，Pages及tunnels為HTTP403。capture→原producer→既有wire validation保留原時間。原desired有其他期望項；差異需要核對帳號與可見範圍，不表示資源已被刪除。私人capture、報告、原settings／grants與候選hash不進公開repo。

| 項目 | 批准後的變更 | 保持／回退 |
| --- | --- | --- |
| Worker／資產 | 更新5個ES modules及4個靜態資產，main_module為worker/index.mjs，加入盤點介面及觀測文案 | 原DB／ASSETS／plaintext bindings與2個secret_text沿用；keep_bindings保留secrets，不讀值、不輪替。原compatibility date、Access、hostname、workers.dev及preview政策不改。回退至保存的原版本100%。 |
| D1 | 只套用0003.sql新增inventory_snapshots表；保存同workspace最新報告，最多24576bytes | 不改前兩份migration／命令／firings／原grants（除下列human提案）。回退保留新表及報告，不刪資料。 |
| 首份報告 | 批准後重新跑固定MCP GET，原工具轉換、驗證及canonical digest；由operator以參數化D1語句匯入一份 | 這是明示的management import，不冒充人類API登入。保留真實observed_at；received_at為實際保存時間。已有更新或衝突報告就停止，不覆寫。 |
| 人類看板 | 原human grant revision2→3；保留原principal／workspace／resource／recipe／限制，只改capabilities為commands:read、artifact:read、inventory:read、inventory:publish，期限到2026-12-02T12:00:00Z | 暫採30天日常草案，待批准。不是人工測試窗口。沒有節點命令提交／取消權；原已到期權限不直接全部續期。Access每次登入的1小時session不延長。撤銷可revoke human grant；回退用新revision恢復原policy，不倒退revision。 |
| bot／runner／scheduler | 不變 | 不續期、不更換HMAC／service token、不重啟runner、不改15分鐘Cron。 |

## 執行與驗證順序

1. 對照保存的Worker version、bindings、Access政策、human revision／policy及D1 schema；不一致先重新產生差異，不以舊批准套不符現況。
2. 保存原Worker內容與部署metadata、原human policy及現有應用表的唯讀摘要。candidate manifest核對每份module／資產／migration及source revision；不得重新產生secrets。
3. 套additive migration，重新收集及匯入首份已驗證報告，發布candidate；最後以原revision／policy條件CAS更新human grant。任何失敗保留receipt，未知結果先回讀，不自動重播。
4. 回讀部署版本、bindings、schema、報告digest／source／times、human新scope及期限；確認其他grants／Access／Cron未變，匿名入口仍受Access保護。新API與UI完整行為已有本機workerd／D1／Chromium證據；management讀回不算本次真人登入驗收。
5. owner可按平常時間登入看板使用，沒有固定待命窗口或手機測試要求。Pages／tunnels維持unknown，不為全綠重新授權。來源與權限回退按上表，不刪表或原證據。

免費限制：不申請付費plan或新付費產品；本輪保存一份小報告、手動更新，未加自動poll盤點或排程。實際provider帳單不是此提案的驗收證據。
