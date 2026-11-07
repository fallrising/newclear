# Independent Grok connection — GC01–04

已依owner選定的獨立工具端，將Cloud Lab接入本機既有Grok Build **1.0.67 (2fe064390d07) stable**。這次完成client註冊與唯讀工具接線，不是已完成Grok自然語言運維或live bot執行。

| AC | 證據 | 狀態 |
| --- | --- | --- |
| GC-01 | 固定已合併MT commit及4份source hash，原client config私人備份，0700持久state／0600 DB | 通過 |
| GC-02 | Grok原生doctor從未註冊exit1變成exit0，command/start/handshake/1 tool全部passed；其他設定語義相等 | 通過 |
| GC-03 | registered argv的status回not_found，check回RPC -32602；自身授權查詢exit1，fresh D1確認bot grant已過期、Access仍有效 | 診斷完成；live授權不可用 |
| GC-04 | 私人原始回執、公開去識別證據／操作說明、獨立審查及Git交付 | 獨立ACCEPT；Git結果見任務板 |

## 實際操作與驗證

- 讀取已安裝client的`--help`、`mcp add --help`、`mcp doctor --help`及本機user-guide；初始`grok mcp list --json`為0 servers。沒有啟動agent prompt、模型或登入流程。
- Source固定為remote MT commit `0233684cd63703a771985f6541793a91c65fc83a`：mcp_stdio.py、bot_bridge.py、live_probe.py、runner.py四檔逐byte取自Git，並以SHA256回讀相等。既有MT的300tests／T839為此source證據；本輪沒有改runtime，不把舊測試計為本輪重跑。
- 備份原user config，先驗證加入單一`mcp_servers.cloud-lab`後TOML其餘語義相等；compare-before-replace與fsync原子更新，保留原mode。只加入固定Python `-B`／source／config／state argv、enabled及startup10秒／tool20秒timeout，沒有allow-submit、secret值、permissions或自動批准規則。
- `grok mcp doctor cloud-lab --json`真正啟動server；結果healthy1/failing0，協議2025-11-25、發現1工具。這是Grok原生MCP連線，不是合成host冒充已註冊。
- 共用launcher GC-client-check讀取已登記的相同argv，以獨立協議驗證器送initialize／initialized／list／status／check；status為not_found，check被拒絕，stdout只含協議結果。此tools/call驗證器不是Grok模型；原生doctor僅驗握手／工具發現。
- 同一檢查以既有bot config執行`runner.py --authorization-status`，exit1、穩定訊息authorization inspection unavailable。沒有掩蓋成授權成功，無命令提交或代續權。
- 2026-10-29T15:01:32.855Z兩次管理面唯讀查詢：D1固定parameterized SELECT僅讀原bot grant，revision2、revoked0，但expires_at **2026-10-29T05:14:04Z**，已過期；Access service token enabled=true、expires_at **2026-11-05T07:43:27Z**。D1報告rows_written0。未讀Worker秘密值；HMAC具體當前期限未由這次metadata查詢確定，不把grant過期推定為唯一失敗層。
- GC-preservation確認4份source hash、原其他Grok設定相等、status-only、private0700／DB0600、SQLite requests數0。私人manifest、設定備份、doctor前後、protocol及auth回執保留；公開不含私有paths、scope、account／token ID或secret。

## 邊界與下一步

Grok現在能發現這個MCP工具；已有session需`/mcps`按r或新開session。原state沒有已提交請求，not_found只證明本地呼叫，不表示讀到遠端健康。bot grant過期是真實後續阻擋；Access有效不等於bot授權有效，也不需因這個結果重跑MCP OAuth callback。

未呼叫Grok模型、未驗自然語言選工具與結果回覆、未開check、未續HMAC/grant/Access、未改Worker/Cron/runner或付費方案。授權查詢可能涉及既有認證nonce寫入，並非宣稱所有認證I/O零副作用；沒有雲端設定或業務命令變更。完整主線、真人Access與HL資產API500仍獨立pending。

下一步需具體有界bot授權計畫，再啟用check做一筆真實提交／結果驗收；不可用runner角色替代bot或用新ID掩蓋未知。停用只需具名`grok mcp disable cloud-lab`，不刪state或以舊整份config覆蓋後續設定。

[T840獨立審查](../../../../.team/reports/T-840.md)ACCEPT，限client接線／診斷文件；只讀兩份公開文件與兩份去敏回執，未讀private或自行重跑。主導已核對private原始回執、設定前後及source hash，evidence gate接受GC01–04接線與診斷，沒有接受live bot授權或模型工作流。
