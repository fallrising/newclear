# M3 第八個切片：AT-11 控制端 model proxy

本切片完成 **AT-11-A：獨立控制端 proxy 的授權、請求額度與用量 ledger**。它以真實 PostgreSQL／HTTP、本機受控文字模型 fixture 驗收。**Guest／OpenHands 尚未接入此 proxy；付費 provider、tool-call／streaming dialect、token／金額硬上限及完整 AT-11／M3 仍未完成。** 目前 Web 建立的任務仍執行 guest 內的 `guest_fixture.py`，不會因啟動此服务自動改走 proxy，也不能把本服務的 request cap 當成現有 agent loop 的整體限制。

## 差距與切片決策

SDD §11.2／§12 要求模型 admission 綁定 run、短效憑證、可計算的預算與未知用量。PR #40 已固定節點 egress；guest 不能直接連線到控制面的私有位址。現有模型是 guest loopback 固定 fixture，沒有控制端模型權威或 durable request ledger。

先把控制端邊界獨立完成，下一個切片再增加專用 guest transport、SDK dialect 與憑證更新，避免在網路例外和模型生命週期尚未驗收時啟用真實 provider。**沒有加入 private-IP override、guest NIC、host shell fallback 或新的自動模型呼叫。** 此服務未連接到工具 admission，模型額度耗盡不會自動停止現有 guest 工具；下一切片必須接上受控收尾。

## 服務與授權

- 專用 CLI：`python -m agent_platform.model_cli --config /private/model.json serve --port 17900`。只綁定 host `127.0.0.1`，停用 access log／proxy headers／公開 schema；不掛載到 Web origin，也沒有遠端 token 發放 API。
- `POST /v1/runs/{run_id}/chat/completions` 使用 `Authorization: Bearer <run-token>` 與 UUID `Idempotency-Key`。拒絕 Origin、Cookie、query、重複 authorization／key、非 JSON 及超過 128 KiB 的 body；錯誤只回固定 code，不回輸入、上游 body、header 或 exception detail。
- 管理 CLI 的 `issue --run UUID --generation N --lease-owner UUID --output /private/run.token` 只為目前 running／leased、已確認 binding 的 OpenHands run 發放。`revoke --run UUID` 撤銷該 run 憑證。管理端持有 DB 權限；generation／owner 是既有 worker 身分，不能藉 CLI 提高 DB generation、延長 lease 或改寫 run。
- Token 隨機 256 bits，DB 只存 SHA-256；有效期至多五分鐘且不超過 run deadline。CLI 只写入私有目錄中的新 0600 檔案，不覆寫、不將 token 放到 stdout／argv。新發放會撤銷同 run 舊 token；額度與請求紀錄不重設。
- 每筆新 admission 依 **job → run** 加鎖，再以 `clock_timestamp()` 檢查 run state、generation、worker owner、live lease、deadline、model reference、binding generation／running／expiry 及未釋放 reservation。等待鎖期間 lease 到期仍拒絕。
- Pausing／paused／resuming／approval／interrupted／cancelling／finalizing／終態均拒絕。Cancel／pause／recovery 的現有 transaction 改變 generation／state 後，新請求即失效，不需要依賴延後收到的 connector fence。Proxy 不更改 VM／claim／journal／fences 或 reservation。
- 此 slice 只允許 `fixture:m2` 和明確 `fixture-http-v1` config：exact `http://127.0.0.1:PORT`，固定 `/v1/chat/completions`。禁止 public endpoint、任意 host/path、provider mode 及 ambient credential。上游只取得控制端專用 fixture key；不轉送 run token。

## 固定請求契約

目前是**文字 fixture dialect**，不是通用 OpenAI／其他 provider 或 pinned OpenHands SDK 相容性宣告：

```json
{
  "model": "fixture:m2",
  "messages": [{"role": "user", "content": "test"}],
  "max_tokens": 32,
  "stream": false
}
```

僅接受 system／user／assistant 文字訊息，最多 128 則，每則 32768 字元；`max_tokens` 為 1–4096 的整數。拒絕 streaming、tools、URL、headers、api_key、provider-specific options 等額外欄位。回覆只接受固定 `model`／單一 assistant choice／`usage` 結構；用量須為非負整數、總和一致且 output 不超過要求值。這是**驗證上游回報值**，不是以 tokenizer 證明真實 token／成本硬上限。

HTTP transport 固定連到配置的 loopback 位址，不讀環境 proxy，不解析來自請求的目的地，不 follow redirect、不自動 retry。要求單一 Content-Length、JSON、無 compression／chunking、最多 256 KiB。Socket idle timeout 五秒，watchdog 與 body 讀取受十秒總期限限制，慢速逐字 header 也不能無限延長；所有 error path 關閉 response／connection。模型回覆中含原樣 run token 或上游 fixture key 時直接拒絕。遮蔽不宣告能防止任意編碼或未知 secret 外洩。

## 額度、故障與用量

`008_model_proxy.sql` 新增 `model_proxy_runs`、`model_proxy_tokens`、`model_proxy_requests`。第一次發放 token 固定整個 run 的 policy digest（包含 endpoint／revision／fixture credential fingerprint／request cap），之後換 key、改 endpoint 或提高上限均拒絕借用舊 run；須建立新 run。額度 1–100，由私有 config 指定，是 **proxy request count**，不是 VM slot、agent turns、token 或金額預算。

1. 在 live ownership transaction 內，按 run 序列化額度計數，為 `(run_id, request_id)` 保存 payload hash 與 `reserved`，commit 後才能呼叫上游。Ledger 不保存 prompt、completion、raw credential 或錯誤 body。
2. 相同 ID／payload 回 409 `model_request_already_reserved`；不同 payload 回 409 `model_idempotency_conflict`。所有狀態都不再次 dispatch，包含 crash 前可能根本沒有送出的請求。**沒有 completion replay**；上游回覆遺失後，不用新 ID 自動補發。
3. 合法回覆將 token counters 設為 `final`；429、連線錯誤、逾時、redirect、損壞／超界／敏感回覆設 `unknown`。每個已 reserve 請求永久占一個本 run 的 request slot；429 也不自動退還，避免假設上游沒有計費。
4. 在 reserve 後或上游成功後 SIGKILL，可能留下 `reserved`；usage 明確計入 `uncertain_requests`，不能當成零。重啟不自動 refund、retry、GC 或降低 generation。結算後 SIGKILL 保留一次 final 紀錄。
5. 網路 I/O 不持有 job／run lock，取消可直接受理。Admission commit 是線性化邊界：**已受理的請求可能在取消／到期後送出或完成，不能撤回外部副作用**。仍保存這筆用量，再檢查授權；舊 generation／已撤銷的 completion 不回傳給呼叫端。新的 admission 全部拒絕。
6. 此切片沒有可信價格契約，所有 `amount_decimal`／`currency`／`price_revision` 為 null，`cost_status: unknown`、`hard_money_limit_supported: false`。`final` 僅代表 fixture token counter 已驗證，不代表帳單已 final 或模型免費。

登入後 `GET /api/v1/runs/{run_id}/usage` 回傳上述 projection，標示 `scope: control-model-proxy-fixture`、`guest_connected: false`。未啟用 proxy 的 run 回 `configured: false`／空 entries／未知費用，不捏造用量為零。`usage.updated` 與 token 發放／撤銷／reservation／settlement audit 只保存固定 metadata。UI 的 backend `usage` capability 仍是 false，沒有把此獨立服務冒充工作台已整合功能。

## 本機驗證與升級

先 drain 並備份既有 DB，套用包含前序的 migration 008；原 migration checksum 不變。API 更新後可查 usage；worker／connector／guest 行為未切換。保留既有 journal、fences、generation 與私密 KVM 配置，launcher 不需重建。

Repo 外私有目錄建立 0600 config 與獨立的高熵 fixture credential（32–128 字元 ASCII token）；不要重用 sandbox、session 或 provider key。Config 例如：

```json
{
  "mode": "fixture-http-v1",
  "origin": "http://127.0.0.1:18090",
  "credential_file": "/private/fixture.key",
  "request_limit": 100
}
```

這只是 fixture 配置範本。兩個獨立程序可分別執行：

```bash
python -m agent_platform.model_cli --config /private/model.json serve-fixture
# DATABASE_URL 由私密環境提供，勿放 argv 或公開 log：
python -m agent_platform.model_cli --config /private/model.json serve --port 17900
```

需要一個具備目前 live DB ownership 的 run 才能發放 token；不要手動修改正式 run state 以滿足測試。本切片的測試專用 DB 會建立模擬 runtime records，完整自動驗收：

```bash
make platform-check
python scripts/test-postgres.py python -m unittest discover \
  -s tests_platform -p test_model_proxy.py -v
```

32 項新增驗收包含真實 HTTP proxy process 重啟、三個 SIGKILL 時點、並行 unique／duplicate request、上限／政策變更／generation／rotation、取消中的結算與 output 撤權、clock-after-lock、真實 socket timeout、429／DB 不可達、redirect／大小／usage 錯誤、token 防漏與 authenticated usage。整套 M0／平台測試結果及 source hashes 見 [公開證據](evidence/m3-model-proxy-2026-09-23.json)。**本次沒有新 KVM／付費 provider 驗收**；不引用前次 18 個 KVM 案例作為新模型通道的證據。

## 下一個里程碑

AT-11-B：在既有 guest isolation／egress 邊界下完成 **guest ↔ control model transport** 與 pinned SDK tool-call dialect。可先評估由 host 經已授權 sandbox port relay 拉取 guest mailbox，避免 guest 能直接存取控制面；此處只是待驗證方向，不能未驗收就宣告支援。需保留 run identity、短效 token rotation、generation／lease／cancel／pause 語意、未知 dispatch 不重送，並在真實 KVM 驗證 terminal 無法讀取／使用控制憑證，跨 run、過期、撤權均拒絕。

之後完成可信 pricing／token 上界、並行金額預留與結算、budget cutoff 的工具／VM 收尾、usage UI，再整合 AT-07／11。真實 provider 必須另有管理員配置與明確 opt-in smoke，不使用任意已有主機憑證。M4 artifact／export／backup／GC 仍未開始。可直接貼到新視窗的提示詞見 [NEXT-PROMPT.md](NEXT-PROMPT.md)。
