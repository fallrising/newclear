# MCP stdio tools — MT01–04

將固定bot bridge接到本機MCP工具host，使用Linux、Python3.11標準庫。這是獨立agent接入層；不修改Kith INV-09、不呼叫模型或代續bot授權、不部署Worker、不新增付費服務。

| AC | 驗收 |
| --- | --- |
| MT-01 | MCP 2025-11-25 initialize／initialized／ping／tools list/call，newline UTF-8 JSON-RPC；有界frame、嚴格envelope、notifications不觸發工作 |
| MT-02 | 僅固定health check/status、唯一UUID參數；config/state/submit由可信host固定，預設僅status；不給shell/URL/secret參數 |
| MT-03 | 固定子程序15秒總等待及8KiB輸出上限，失敗只輸出受限結果；超時不表示未提交、不自動重試或換ID；保留bridge journal |
| MT-04 | RGR、真實stdio／HTTP／collector閉環及完整回歸、獨立review；文件說明host配置與未驗證live／Grok邊界 |

協議依據：[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。支援版本固定為2025-11-25；客戶端提出其他版本時回此版本，由客戶端決定是否斷線。不宣稱所有MCP版本或所有Grok client相容。

## Host設定

受信任host以argv啟動`python3 platform/cloud-lab/tools/mcp_stdio.py --config /private/operator/bot.json --state-dir /private/operator/bot-state`。預設只暴露`cloudlab_health_status`；加`--allow-submit`才暴露並允許`cloudlab_health_check`。路徑必須固定在host設定，不交給模型。state沿用唯一0700 Git外目錄、config0600；不安裝或改動任何既有MCP設定。

工具參數只有`{"request_id":"12345678-1234-4234-8234-123456789abc"}`。ID是本地durable去重鍵，每個新意圖產生一次，重試與查詢保留原ID。提交返回accepted不代表完成；稍後用status查詢，沒有自動poll。`structuredContent`與text content呈現同一bot結果；必須讀state/verified/health，不把MCP isError=false當健康或完成。

## 邊界

串行處理，一次一個bridge子程序；每個session最多每秒一次有效工具呼叫，超額回isError／RATE_LIMITED、不啟動子程序；重啟不保留此速率計數，跨session頻率由host管控。JSON-RPC ID接受最多128字元字串或安全整數（絕對值不超過2^53−1），不接受null／boolean／fractional ID。單frame最多16KiB（含換行），過大或EOF前未完整換行回錯並結束session，不無限drain。無batch、sampling、prompts、resources、tasks或任意工具；未知notifications忽略，不執行tools/call notification。stdio只輸出JSON-RPC；敏感錯誤與子程序stderr不傳回模型。

子程序等待上限15秒、stdout最多8KiB；到期／超限／異常輸出為unconfirmed，command_id不猜測、health清空。終止子程序不撤銷可能已接受的遠端命令。保留state後以原ID查詢或明確重送；不要新建ID掩蓋未知。單次請求不可透過MCP cancellation保證撤銷，通知不改遠端工作。關閉stdin在當前有界請求後退出；SIGTERM／SIGINT清理所啟動的子程序群組。同OS使用者與可信source不構成sandbox；kernel I/O卡住不在硬即時保證內。host仍須管理客戶端生命週期、頻率與state保存。

本輪不包含實際Grok模型呼叫、Kith管理工具ADR、遠端MCP HTTP端點、授權續期或帳單驗收。HL資產API500維持獨立未完成任務。

## 可複製的接入範例

以下為常見工具host的合成配置形狀，實際設定鍵依host而定；程式與config需採固定絕對路徑。status模式不包含提交開關：

```json
{
  "mcpServers": {
    "cloud-lab": {
      "command": "/usr/bin/python3",
      "args": [
        "/opt/newclear/platform/cloud-lab/tools/mcp_stdio.py",
        "--config", "/private/operator/bot.json",
        "--state-dir", "/private/operator/bot-state"
      ]
    }
  }
}
```

依序送出initialize（params含protocolVersion／capabilities／clientInfo）、notifications/initialized、tools/list，再tools/call。可直接使用下面的call frame；每個frame一行UTF-8 JSON，以換行分隔，不是HTTP Content-Length framing：

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cloudlab_health_status","arguments":{"request_id":"12345678-1234-4234-8234-123456789abc"}}}
```

Tool input驗證錯誤回isError／INVALID_REQUEST；未知工具、非法RPC結構或未完成初始化回JSON-RPC error。private config/state錯誤回bot-error固定code；API拒絕、未知提交回bot-response且isError=true。not_found／unknown／stale的isError=false僅表示查詢已回結果；只有validated且verified=true才是新鮮已驗觀測。output沿用[bot-response schema](../contracts/bot-response.schema.json)，不輸出artifact／scope或server自由文字。MCP ID只關聯本次RPC，不能代替持久request_id。

[本機證據](evidence/m1-mcp-stdio.md)與[bot恢復契約](bot-bridge.md)說明超時後流程。部署到實際工具host時，先驗證initialize/list與status，再在已批准且有效bot授權內啟用check；本開發階段未進行該live接線。

後續[GC獨立Grok接線](grok-connection.md)已完成實際client註冊／握手與唯讀工具驗證；[GC證據](evidence/m1-grok-connection.md)明示bot grant過期，沒有啟用check或模型執行。上文保留MT開發階段的範圍。
