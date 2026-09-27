# AT-11-C2b2：固定 HTTPS provider 與 profile 驗證契約

本切片增加 OpenAI Chat Completions 相容的固定 HTTPS transport，以及由不可變 profile revision 釘住的任務驗證命令。HTTPS transport 只在控制端 worker 執行；guest 仍經既有 mailbox，沒有 provider key、私網例外或新的 guest egress 路徑。`amount_decimal` 仍為 null，`hard_money_limit_supported` 仍關閉。程式已合併。2026-09-27 在 `kvm8745` 用本機 TLS mock 通過 `mock-https-complete` 與 isolation。9 月 24 日那次 EACCES 失敗和當時的 journal 已不在重灌後的機器上，不再當成未完成 gate。

預定以後換上的真接口是 [OpenCode Zen](https://opencode.ai/docs/zen) 的 Chat Completions：`https://opencode.ai/zen/v1/chat/completions`。key 從 [opencode.ai/auth](https://opencode.ai/auth) 建立，只放執行主機的 0600 檔，不進 git、不進對話。現在沒有這份 key，開發繼續用本機 mock。Zen 上走 `/v1/responses` 或 `/v1/messages` 的模型還不能用這個 transport。公開價目不是本平台的帳單。

## 固定 HTTPS policy

私有、0600 的 `MODEL_PROXY_CONFIG` 使用獨立模式 `openai-compatible-https-v1`：

```json
{
  "mode": "openai-compatible-https-v1",
  "endpoint": "https://provider.example/v1/chat/completions",
  "credential_ref": "/private/provider.key",
  "ca_bundle_file": "/private/provider-ca.pem",
  "model": "provider-model-id",
  "request_limit": 10
}
```

`endpoint` 是完整固定路徑；拒絕非 HTTPS、userinfo、query、fragment、模糊／越界 path 及不安全 hostname。Request body 或 task input 不能改 endpoint。Credential 只讀自獨立私有檔案 reference，僅由 worker 以 Bearer header 送出；設定與 secret 檔案都須由服務 UID 擁有且不可被 group／other 讀取。可選 CA bundle 也須是私有檔案。

Policy digest 固定 endpoint、model、request cap、credential fingerprint、CA bundle fingerprint 及 TLS 設定。TLS 最低 1.2，驗證憑證鏈與 hostname；transport 使用固定 HTTPS connection，不讀 ambient proxy 環境變數、不 follow redirect、不自動 retry。只支援受控的 Chat Completions 非串流相容子集；streaming 與其他 provider 原生 dialect 另需 adapter。

Provider 回報的 usage 只標示 `provider_reported_usage_unbilled`；沒有可信帳戶費率、token 上界、稅／折扣或 invoice 對帳，因此金額仍 unknown，不宣稱硬金額上限。不能把 mock／fixture counters 當實際 provider 帳單。

## Profile-pinned 任務驗證

每個 immutable profile revision 保存 strict verification policy。模式如下：

- `none`：預設值。沒有驗證器時結果為 `unknown/verification_not_configured`，run 不會標示成功。
- `commands`：需要 1–8 個唯一 ID 的固定 argv 命令；每個 timeout 為 1–60 秒，總 budget 不超過 120 秒。命令不經 shell，在 guest workspace 直接執行，使用固定環境與 bounded process group。
- `fixture-m2`：只供既有固定 M2 acceptance harness 使用，檢查 `m2-result.txt` fixture contract，不代表一般 repository 測試。

命令及 policy revision 隨 profile digest 固定，task／model response 不能替換。單一 check 最多輸出 1 MiB，結果只保留 check ID、狀態、exit code、固定 reason 與 output hash，不保留輸出原文。Timeout、輸出超界、程序終止不確定或 verifier 改動 workspace 都是 unknown；非零退出為 failed。只有全部 checks 退出 0 且 workspace diff 未被 verifier 改變才是 passed。Connector 重新驗證 revision、policy hash、結果順序、diff hash 與狀態；unknown 不可轉成 succeeded。

這只代表 operator 明確配置的命令通過，不保證該命令集合完整、獨立或適合所有 repository；不可用空 policy 宣稱 tests passed。

## 驗收狀態與限制

- 最新 `make platform-check` 通過：45 個 dependency-free unit tests、200 個 PostgreSQL／HTTP platform tests、Ruff lint／format。兩個需要平台依賴的新測試已移入 `tests_platform`，使 fast CI check 保持依賴隔離；Web CI 的舊狀態文案 assertion 已修正。GitHub Actions run `36008490179` 的 check／web／control-plane 全部通過，含 browser acceptance。本機 Web check 因環境沒有 Node/npm 未執行。
- 2026-09-24 的第一次 KVM 因 sandboxd 沒有 `sg kvm` 而 EACCES，並留下一筆無 handle 的 intent。那台 controller 已重灌，那些目錄不在了。2026-09-27 在 `kvm8745` 用新的 state directory 通過 `mock-https-complete` 與 isolation，結束時 VM／claim 為零。
- 無 handle 的 `allocate=started` 若再次出現，只能用 `agent-platform reconcile-unconfirmed-allocation` 在同一 journal 對帳。不能手刪 row、換 state directory、降低 generation，或改用 direct driver。
- 真接口尚未呼叫。開發用本機 mock。OpenCode Zen key 出現之前不切換。24 小時實機停留留到 release 前。
