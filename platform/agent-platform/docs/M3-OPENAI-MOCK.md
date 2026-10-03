# AT-11-C2b1：OpenAI 相容介面的本機 mock 驗收

本切片回應本地平台接模型 API 的需求，先以控制端 loopback mock 驗收 OpenAI Chat Completions 的文字／function tool-call 請求、回應與既有 guest／KVM 流程。**這仍是腳本化模型**：不解讀自然語言目標、不連付費或外部 API，也不提供 Claude／Gemini 原生介面、任意 endpoint、可信金額或 usage UI。真實接口與帳戶條件留待使用者提供後另作明確 opt-in E2E。

## 配置與資料邊界

在私有 0600 `MODEL_PROXY_CONFIG` 中使用獨立模式：

```json
{
  "mode": "openai-compatible-mock-v1",
  "origin": "http://127.0.0.1:18090",
  "credential_file": "/private/mock.key",
  "model": "local/mock-agent-v1",
  "request_limit": 10
}
```

`model`、endpoint、credential fingerprint 與 request cap 一起釘在 run policy digest；更換任一項不能接管舊 run。模式只允許精確的 host loopback HTTP 位址，拒絕公開 URL、預覽價格及合成 credit 配置。`serve-mock` 可在控制端啟動此 0600 配置所指定的 mock；全部 real workers 同時設定 `MODEL_PROXY_CONFIG`。未設定的 run 仍沿用原 guest fixture。

Guest 只使用原本 OpenHands SDK 與 mailbox；worker 在控制端將 SDK 的固定 `gpt-4o-mini` wire 名稱映射為配置的 mock model ID，送到固定 `/v1/chat/completions`。JSON body 使用 `model`、`messages`、`tools`、`max_tokens`、`stream:false`，不含 `fixture_run_id`；控制端仍限制文字／text parts、terminal／finish／think、4096 output tokens、單一回應和 128 KiB／256 KiB 大小。為了沿用現階段只認 `m2-result.txt` 中 run UUID 的固定 workspace assertion，**本機 mock transport** 另外送 `X-Local-Mock-Run-Id` header。它只在此 loopback mock 模式送出，未來真實 provider adapter 不得沿用這個測試欄位。這個腳本化驗證仍不代表任意程式任務已可用。

Mock 回應採 Chat Completions 常見的 `id`、`object`、`created`、`choices`、`usage` 形狀。控制端只保留已驗證的 assistant 文字或已允許的 function calls 與三個整數 usage counters；拒絕未知工具、錯誤模型、截斷的 `length`、超界／缺失用量或含控制憑證的回應。其他 provider metadata 不傳入 guest。這是明確的相容子集，並未聲稱所有 OpenAI-compatible 服務可無修改接入；正式 E2E 需用使用者提供的接口驗證具體 dialect。

## Admission 與故障

沿用 AT-11-A／B 的 job→run live ownership、短效 token、SQL request UUID、先 commit reservation 再 dispatch、無自動 retry／redirect、回覆後重新授權與 connector durable delivery。合法 mock 回報值只結算 token counters，`amount_decimal:null`、`cost_status:unknown`、`hard_money_limit_supported:false`。損壞或超界回報將該請求保留為 unknown；request cap 截止或模型錯誤會持久撤權並停原 VM，停止證據不足時資源 reservation 保留。Mock 專用 header／key 均不進 guest 或公開事件。

此切片沒有 DB migration、launcher 或 OCI rebuild。部署前仍須完整 drain，保持既有 journal、fences、generation；在同一批 API／worker／connector 程式下配置新模式。不要將現有主機 provider key 當授權，也不要藉全節點 private-IP override 開 guest 網路。此 mode 只用 0600 mock key，不會發生付費請求。

## 驗收與下一步

執行 `make platform-check`、`make web-check`，再於 explicit deny-all、zero-warm 節點跑 `m3-guest-model-kvm.py` 的 `mock-complete`、`mock-cutoff`、`mock-unknown`。案例分別確認兩次工具循環與 workspace assertion、額度截止不放行 terminal、超界用量 unknown 並完整收尾。公開結果與測試 hash 見 [evidence](evidence/m3-openai-mock-2026-09-24.json)；原始請求、key、journal 留在 repo 外。

後續需要新增獨立 HTTPS provider transport、可安全配置的 endpoint／credential、具體 OpenAI-compatible 服務的 dialect smoke，以及 Claude／Gemini 原生 adapter 的契約驗收。真實價格、token 上界、計費例外與帳單對帳尚無證據；在那之前不能啟用硬金額上限。任意自然語言 coding 還需替換目前固定 workspace assertion，並驗收其 repository 測試／artifact 流程。
