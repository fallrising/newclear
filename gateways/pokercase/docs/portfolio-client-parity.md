# Thinrouter 具名相容性矩陣

決定：繼續維護 Thinrouter。可借鑑的具名行為是 Claude 串流中取消時如何中止原生進程並記錄終態。等具名客戶端出現既有實作無法滿足的案例，再比較相同輸入在兩端的結果。現有材料不足以支持切換 gateway。

基準為 newclear `462f392ffb8299ff10aedde05f6c16e62095a7d9`。從規劃 pin `2aa21f10b53ecaeb079279b6531bbb47a103e937` 到本基準，Pokercase 與 PG-JEV 目錄差異為空。[原始 17 AC 與證據](../SUCCESS.md) 是產品驗收入口。表中「合成」包含真 gateway 搭配 fake 上游／CLI；「原生」指固定 binary 或本機程序；「live」只涵蓋當次帳戶、版本、協定及輸入。未記錄處均為未知。

| 客戶端／上游及原 AC | text、tools 與傳輸 | 取消、timeout 與重啟 | usage 與證據界限 |
| --- | --- | --- | --- |
| Chat Completions、Messages、Responses → SIWC（06–09） | 三協定 text、tool 往返與圖片，client stream/buffer，上游強制 Responses stream。07 為 session/cache 標識，09 為舊連線遷移。 | 合成 HTTP settlement 有失敗終態；真帳戶取消、timeout 與重啟組合未知。 | 合成 usage 與轉換；08 的官方登入、refresh 與完整 live 相容仍 pending。 |
| 三協定 → Claude Code（04、10–15） | 合成涵蓋 stream/buffer、工具、MCP callback、Responses 事件；live 僅 Messages 固定輸入：CLI 2.1.312 文字重用與重啟 3/3、工具呼叫及同進程結果 2/2。 | 合成驗證中止與 session fallback；動態指令續輪另一次 live 在重啟後以原 session 恢復。其他 client 的取消／timeout 仍未知。 | 動態續輪 3/3，三列 usage 跨重啟保留。曾有 HTTP 401（trust/login/onboarding 類別）及首請求 429；成功重試有獨立授權，舊預算均關閉。 |
| 三協定 → Cursor Agent CLI（04、17） | 17 覆蓋文字 stream/buffer；工具仍是 04 的待決範圍。原生選擇是 cursor-agent CLI；owner 已取消 Docker 產品要求，既有 runtime 遷移仍待驗。 | 曾有兩次 502；2026-10-24 corrected runner 單次 Chat 非串流純文字 live 成功（200，5.897 秒），工具與圖片的既有拒絕契約為 501。合成 CLI 的 timeout、取消與結算案例；真 CLI 對應的完整重啟旅程未知。 | 合成 usage 覆蓋不代表真帳戶用量。保留原 17 歷史條件與 04 pending。 |
| Grok、OpenCode、Antigravity（01、02、16） | 01 是當時 smoke；02 是 adapter 定位，16 是借用 Grok 憑證遇 401 的一次重讀。stream/buffer 與 tools 依個別 protocol fixture。 | HTTP/CLI settlement 的合成取消、失敗或重啟情境依測試範圍；全組 live 未知。 | 逐 attempt 結算保留未知及部分 coverage；早期 smoke 沒有跨客戶端計量證明。 |
| 所有客戶端入口（03、05） | gateway key、admin 授權與 bootstrap 各有獨立條件。 | 拒絕時應在 dispatch 前停止；此驗證不涵蓋已發請求的中止。 | 本機隔離驗證，不構成訂閱或跨 gateway 等價證據。 |

下游 client 身份另依[配置文件](CLIENTS.md)與[原驗收對帳](tasks/T-0426-mainline-acceptance.md)查核：

| 下游客戶端 | 已有證據 | 待驗範圍 |
| --- | --- | --- |
| curl | OpenAI 與 Anthropic Messages 請求範例 | 實測版本及完整旅程未知 |
| Cursor Agent CLI | 配置說明，角色為 gateway 客戶端 | 下游版本與端到端工具、取消、用量未知 |
| Claude Code | OpenAI-compatible 配置範例 | 下游版本與端到端旅程未知；上述 2.1.312 是上游 CLI，發請求的是限定 HTTP Messages 測試客戶端 |
| Continue.dev、Cline、Roo | 各自的配置說明 | 版本與端到端 text/tools、stream/buffer、取消、timeout、重啟、usage 均未知 |

[動態續輪及用量回執](tasks/T-0426-dynamic-renewed.md)、[已關閉的 429 嘗試](tasks/T-0426-dynamic-live.md)、[401 原始回執](tasks/T-0426-tui-pilot.md)、[工具續輪](tasks/T-0426-tui-tools-renewed.md)、[Cursor 決策](cursor-isolation.md)、[緩衝 CLI 結算](tasks/T-0432-buffered-cli-settlement.md)。

## 比較端與停止條件

| 比較端 | 查到的行為與可用證據 | 尚無對等驗證的項目 |
| --- | --- | --- |
| Magpie fork 40b36247d281699a0bc1ba36648c9de80dedcd63 | routing 與 Claude subscription bridge 文件描述帳戶選擇、串流事件、工具續輪、client cancellation／interrupt 及用量聚合。這些是文件證據。 | 三種協定的 stream/buffer 逐項輸出、工具回傳、取消後停止時間、timeout、重啟後身份與 usage 去重，均缺同一版本、同一旅程的對照。 |
| Magpie Trial v0.1.1239 | 固定 binary 的原生 version/list 與當時限定代理接線屬 Magpie 的歷史採用證據。 | Cursor 接線待驗；完整 text/tools、串流、緩衝、取消、timeout、重啟與 usage 矩陣未知。 |
| PG-JEV | [既有資格](../../../labs/pg-jev-router/SUCCESS.md) 驗證 PostgreSQL 與合成 provider 的 allow/block/review 及 profile 建議。 | 無 dispatch 或授權職責；gateway 傳輸、CLI 停止、重啟與計費比較不適用。 |

本次保留兩邊既有設定及資料。現階段到「保留 Thinrouter」即可結案。如有具名 consumer 的必要差異，先固定版本、原 AC、回退與可用證據，再決定是否另案驗證。真帳戶測試與切換需另有授權。
