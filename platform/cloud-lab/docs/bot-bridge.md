# Fixed bot bridge — BC01–04

為Grok或其他agent提供單次stdin JSON／stdout JSON的固定工具入口；只支援health.check與health.status。這是bot client adapter開發，不是已接通Grok、MCP server或對外訊息服務；不呼叫模型、不新增費用或更新live授權。HL排程部署保持獨立阻擋。

| AC | 驗收 |
| --- | --- |
| BC-01 | 嚴格4KiB JSON envelope、固定operation與canonical UUID request_id；未知欄位／重複key／任意URL或shell拒絕。可信CLI固定config/state，提交另外需要--allow-submit |
| BC-02 | 私人0600 SQLite durable request記錄與nonblocking單writer lock；同request_id固定bytes/key/deadline／config fingerprint，保存後才POST。ACK遺失重送原bytes，已有ACK僅查詢，不刷新期限、不另建命令 |
| BC-03 | status不POST，關聯同一command與payload；accepted與verified分開，unknown／stale／過期／拒絕保持誠實；只輸出受限欄位，無secrets、scope、任意server文字或artifact |
| BC-04 | RGR、真實本機HTTP→原Python collector→status與重送／撤權／CLI驗證、完整回歸及獨立審查；無live變更或Grok成功冒稱 |

狀態目錄必須由operator預先建立0700，位於Git外；config沿用private bot bundle。Bridge不使用config中的runner journal_path，不啟動runner。只接受已登記node-health語義，scope由固定config及server grant共同決定；request_id是去重鍵，不是授權。

工具host須把config、state-dir及--allow-submit固定在受信任的呼叫設定，不能讓模型改CLI或讀憑證。模型僅提供schema_version、operation、request_id；不接受command_id／任意路徑。提交屬控制面寫入，即使collector為唯讀也需要操作者允許。真正Grok tool binding、model invocation與live續權另行驗收。

輸入版本cloudlab.bot-request.v1，操作health.check或health.status。每個使用者意圖使用一個canonical UUIDv4；重試／查詢沿用同一ID，新的ID代表新工作而非安全重試。一次check最多bootstrap及一次POST；status或已知ACK只做一次GET，沒有背景poll或自動網路重試。HTTPS驗證與禁止redirect／環境proxy沿用現有probe；socket timeout5秒、回應32KiB，但不是整個程序的硬deadline，工具host應限制stdin及程序總時長。

## 呼叫

先由operator準備既有bot config及唯一state目錄；Linux、Python3.11標準庫，沒有第三方runtime。以下全為合成路徑／ID：

```sh
mkdir -m 700 /private/operator/bot-state
printf '%s\n' '{"schema_version":"cloudlab.bot-request.v1","operation":"health.check","request_id":"12345678-1234-4234-8234-123456789abc"}' | python3 platform/cloud-lab/tools/bot_bridge.py --config /private/operator/bot.json --state-dir /private/operator/bot-state --allow-submit
printf '%s\n' '{"schema_version":"cloudlab.bot-request.v1","operation":"health.status","request_id":"12345678-1234-4234-8234-123456789abc"}' | python3 platform/cloud-lab/tools/bot_bridge.py --config /private/operator/bot.json --state-dir /private/operator/bot-state
```

[request schema](../contracts/bot-request.schema.json)／[response schema](../contracts/bot-response.schema.json)供工具host適配，CLI不是MCP／Grok SDK服務。每次讀到EOF才處理一份JSON，輸出一行JSON；host應關閉stdin並施加總期限。不要把完整config或任意CLI命令放進模型context。前述CLI的--allow-submit是host設定，JSON不能打開它。真實config中的bot HMAC／grant必須有效，失效應返回denied，adapter不會代續權。

## 恢復及結果

requests.sqlite記錄request_id、完整config的SHA256 fingerprint、固定payload／digest及取得後的command_id；不保存secret原文。SQLite FULL synchronous transaction在POST前完成，原payload包含固定scope、node-health、10秒／16KiB上限及60／120秒期限。同ID再次check：有ACK時只GET；缺ACK時只重送原bytes，即使期限已過也不刷新。Server可回同一已存命令；若原請求未被接受且已過期，拒絕保持unconfirmed，由operator對帳，不能換ID掩蓋未知。

status無ACK時回unconfirmed且不聯網；沒有本地ID時回not_found。已有ACK的status是GET，仍需有效server授權。它可能建立／檢查本機SQLite schema與lock，HMAC GET也可能寫server nonce；「唯讀」限定不提交控制面業務命令。並行呼叫由持久bridge.lock的非阻塞FLOCK拒絕STATE_BUSY；重試仍用同一request_id。狀態目錄／DB／lock不能丟棄或換位置來恢復，config任何變更都會使舊ID拒絕重綁，需operator對帳。

回應只含版本、request_id、operation、state、固定code、command_id、verified、health及observed_at。accepted／dispatching不是完成；reconciling投影unknown。只有同一payload／command、succeeded、validator passed、合法時間及30秒freshness才為validated；unhealthy也可表示成功取得不健康觀測。舊結果為stale、未來或驗證不全為unverified，兩者health=null／verified=false。401／403為denied，不沿用之前的健康值；不回傳artifact、私有scope、URL、server自由文字或憑證。

退出碼0表示已產生可理解的狀態（包括not_found／unknown／stale），**不是執行成功**；1為unconfirmed／denied／error；2為輸入、未開提交或私人設定／狀態錯誤。消費者必須檢查state及verified，不以exit0宣布工作完成。

## 範圍與限制

不含list／cancel／任意recipe／agent原生run或聊天發訊息；既有executor與工作驗收authority保留。沒有自動retention、state backup、總請求budget或用量熔斷；新ID會增長本機journal，受信任工具host需限制頻率，server仍執行既有單active／quota。SQLite／FLOCK是同機合作程序的邊界，不是阻擋相同OS使用者的sandbox。保留state才能恢復原請求。

[BC本機證據](evidence/m1-bot-bridge.md)記錄當時RGR、SQLite、HTTP與OS collector。後續[獨立Grok工具接線](grok-connection.md)、[真實bot閉環](evidence/m1-bot-activation-live.md)及[HL窗口修正](evidence/m1-health-schedule-window-live.md)已完成相應子集；原HL pending是歷史狀態。bot窗口已到期，不宣稱目前可提交或模型對話已驗。近期順序見[方向調整](direction-review.md)。

後續[MT MCP stdio wrapper](mcp-stdio.md)提供固定tools/list/call及有界child；BC CLI本身仍是單次JSON程序，持久state／授權及恢復語義不變。

## BP持久政策

[私人租期／配額](bot-policy.md)用`--policy`及明確離線`--initialize-policy`接入原SQLite／FLOCK；保留舊request與payload，先持久reservation再網路。新版本的已綁定state不能省略政策執行，未綁定state保留原operator模式。
