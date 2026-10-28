# Machine self-authorization — SA01–04

本輪建立目前Worker HMAC metadata的直接來源。原Lab授權已過期；不為了讀取metadata繞過認證、不續權、不部署。runner程序觀測另外列明契約，不從啟動檔推定目前程序狀態。

| AC | 驗收 |
| --- | --- |
| SA-01 | POST /api/authorization/self只接受空JSON與已通過原HMAC／有效grant的機器，回傳自身credential、grant期限及scope白名單；無secret／其他key／任意查詢 |
| SA-02 | Python runner提供獨立authorization-status模式：固定簽名請求、嚴格回應／identity／scope／時間驗證；不建立journal或鎖、不claim／report；stdout不含識別值或secret |
| SA-03 | 過期／撤銷／錯簽名／replay／真人JWT／漂移回應拒絕；真實本機HTTP→Worker→D1→Python CLI測試證明沒有command／grant／journal變更 |
| SA-04 | OpenAPI與來源／輪替前置文件、RED/GREEN、獨立source審查及正常Git交付；live部署與原Lab已知缺口不冒稱完成 |

## 來源與限制

此介面使用正常機器認證，回應直接來自同一次驗證採用的MACHINE_KEYS entry及D1 grant。只有已認證的機器可讀自己的metadata；沒有額外管理能力，不能選另一credential。回傳schema為cloudlab.authorization-self.v1，含observed_at、credential(id/generation/principal_id/grant_id/revoked/expires_at)、grant(id/revision/principal_id/not_before/expires_at)、scope(workspace_id/resource_ref/recipe_ref)及request_id。只接受POST空JSON，正常防重播nonce仍寫D1；因此是無業務變更的查詢，不宣稱完全無資料庫寫入。

Credential驗證失敗401，grant拒絕403，human403；不藉此提供過期credential的匿名查詢。API結果是當次Worker觀察，不保證跨版本部署所有流量一致或之後不變。無Access服務token期限、真人session或runner程序證據。

## runner操作

`runner.py --config /private/runner.json --authorization-status`使用既有TLS／HMAC及可選Access header，只請求一次，不重試；採直接TLS、5秒socket timeout與32KiB上限，另有10秒monotonic總期限；超時shutdown已連線socket、禁止重新連線，遲到的DNS／connect完成不再送出請求。DNS本身可能留在daemon thread直到OS返回；CLI與呼叫端不等待它。自訂library client須自行提供同等transport界限。此模式不能與once／stop-at混用。輸入需owner0600一般單連結檔案，拒絕最後一層symlink；operator須提供可信私人parent目錄。輸出僅metadata來源時間與期限，不含URL、id、scope或秘密。

Client嚴格驗證schema、credential id/generation、grant引用及scope與目前載入config相符，請求總時間不超過10秒，server observed_at與本機請求窗口偏差最多120秒。這不是時鐘同步證明；回應有效期限仍由各層判定。舊Worker404、過期401／403、未知schema及任何漂移一律失敗，不回退舊bundle。正常runner模式不增加額外網路查詢。

## runner程序來源契約與受控輪替前置

未來runner期限觀測必須由同一實際resident invocation產生，綁定instance、boot/process start identity、載入config digest及stop-at；觀測者需回讀程序身分與持鎖狀態，拒絕退出／PID重用／換設定／過舊證據。磁碟unit、舊log或手動傳入stop-at只能列作配置／歷史資料，不能填入目前runner_stop_at。本輪維持unknown，不把查詢CLI當常駐程序。

輪替前先完成這個程序觀測來源，再指定target、role、明確期限、新generation及回退值；採集新鮮D1／Access狀態、對帳在途工作、保存私人receipts，準備逐項可回讀的變更。已過期HMAC需operator在明確批准的維護窗口更新，不能靠本API自救或自動延長。此次沒有生成secret或可執行續期計畫；未選期限之前不產生虛構批准範圍。

本輪只改source，部署後的新介面才可提供此來源；既有AS MCP採集器仍不會自動合併self response，AL snapshot不因新增CLI而變完整。接入需保留target／scope／identity、來源時間及部署版本證據。
