# AT-11-C2a：公開費率的金額預留演練

本切片在真實 PostgreSQL ledger 與固定 KVM guest model 通道上，增加一個**明確啟用、只對本機 fixture 生效**的美元價目演練。它使用可核對的真實模型公開費率與 token 規格，驗收金額上界、並行預留、合法計量結算、未知用量保留全額及額度截止後的原 VM 收尾。模型請求仍送往控制端 loopback fixture；**沒有呼叫付費 provider，沒有把 fixture 用量當成真實帳單，也沒有啟用硬金額上限**。完整 AT-11-C2／AT-11／AT-07／M3 仍未完成。

## 價目與適用條件

固定參考模型為 `gpt-4o-mini-2024-07-18`。OpenAI [模型規格](https://developers.openai.com/api/docs/models/gpt-4o-mini)列出 128,000 context tokens；[公開快取價格公告](https://openai.com/index/api-prompt-caching/)列出 Standard 純文字每百萬 input US$0.15、cached input US$0.075、output US$0.60。本演練用較高的**非快取**輸入費率，忽略快取折扣。以 128,000 input 與固定 SDK `max_tokens≤4096`，單筆預留上界為 `128000×150 + max_tokens×600` nanodollars；最大全額是 **US$0.0216576**。128,000 是成功請求的公開 context 上界所作保守推論，不是對目前 Chat Completions tool-call payload 做精確 preflight；fixture 的 canonical JSON bytes 規則不能套用至真實 provider。

此公開費率只適用於 OpenAI direct、公開 pay-as-you-go、Standard、USD、稅前、純文字且沒有額外收費功能的假設。[OpenAI Services Agreement §6](https://openai.com/policies/services-agreement/)允許個別 Order Form 價格、稅及公開價格變更／更正；模型 snapshot 並不固定帳單費率。Operator 必須自行核對其帳戶適用條件，提供 24 小時內到期的明確確認。即使如此，本切片僅是價格演練；實際 provider adapter、帳戶價格核對與對帳尚不存在，`amount_decimal`、`currency`、`price_revision` 保持 null，`cost_status: unknown`、`hard_money_limit_supported: false`。Usage API 新欄位以 `published_price_preview` 和 `quote_*` 命名，不能當作 provider 支出。

私有 0600 `MODEL_PROXY_CONFIG` 可在原 fixture 設定中加入以下欄位。這是**演練授權，不是使用 provider key 的授權**；不能同時設定 `fixture_budget`。時間需為 UTC `Z` 格式，`expires_at` 必須晚於 `verified_at` 且最多相隔 24 小時。以下數字與日期僅示意，不能照抄作當前確認：

```json
"published_price_preview": {
  "limit_nanodollars": 100000000,
  "verified_at": "2026-09-24T00:00:00Z",
  "expires_at": "2026-09-25T00:00:00Z",
  "public_payg_standard_confirmed": true
}
```

`011_published_price_preview.sql` 只增加獨立 preview 欄位，保留舊 migration 對真實金額欄位的 null 約束。未啟用者政策 digest 與既有 run 行為不變。啟用時價目版本、上限、確認與到期時間加入 run policy digest；token 輪替、worker 接管或修改配置均不能重新計價或增加舊 run 額度。到期後拒絕發 token、新請求及 terminal admission；已 admission 的 response 仍依原政策保存用量，取消／pause 後不交付撤權 completion。

## Admission、結算與故障

Admission 仍先取得 job → run 鎖，確認 live ownership／binding，在上游 I/O 前保存 request UUID、payload hash 與整筆預留。不同 UUID 並行請求序列化；final 用已結算的估算值占額，reserved／unknown 用完整預留占額。超過上限回 `model_price_quote_exhausted`，零次上游 dispatch；worker 沿既有 durable cutoff 關閉模型及 terminal，完整 VM／claim 停止證據前不釋放 resource reservation。

合法 fixture counters 只能在 `prompt_tokens≤128000`、`completion_tokens≤max_tokens` 時按固定非快取公開費率結算**演練估算**。429、timeout、損壞／缺失 usage、超界值與 SIGKILL 後未知 dispatch 均不退款、不重送；原完整預留繼續占額。Usage API 同時保留 fixture credit 與 preview 欄位的清楚區隔；Web usage capability 尚未開啟。

## 驗收與後續

部署須先完整 drain／備份 DB，套用 migration 011，再同步更新 API／worker／connector。保留 journal／fences／generation；不重建 launcher 或 OCI template，不原地修改 active guest。沿用 explicit deny-all sealed node、控制端 fixture credential、host 拉取 guest mailbox、沒有 guest 私網例外及沒有 host shell fallback。公開驗收證據見 [AT-11-C2a evidence](evidence/m3-published-price-preview-2026-09-24.json)；原始 payload、key、logs 仍只存於 repo 外。

```bash
make platform-check
make web-check
python scripts/test-postgres.py python scripts/m3-guest-model-kvm.py \
  --config /private/connector.json --origin http://127.0.0.1:17888 \
  --case published-price-preview --output /private/new-acceptance-directory
```

下一個 C2 切片需有獨立的真實 provider transport 與明確 opt-in key、帳戶實際費率／適用條件核對、Chat Completions token／計費例外驗證、真實金額欄位與安全 usage UI；之後再跑明確 opt-in 付費 smoke。沒有這些證據不能把 preview 升格為硬金額帳單上限。
