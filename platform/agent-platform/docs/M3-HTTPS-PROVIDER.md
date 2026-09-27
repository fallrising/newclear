# AT-11-C2b2：固定 HTTPS provider 與 profile 驗證契約

本切片增加 OpenAI Chat Completions 相容的固定 HTTPS transport，以及由不可變 profile revision 釘住的任務驗證命令。HTTPS transport 只在控制端 worker 執行；guest 仍經既有 mailbox，沒有 provider key、私網例外或新的 guest egress 路徑。此切片未呼叫真實 provider，`amount_decimal` 仍為 null，`hard_money_limit_supported` 仍關閉。程式與單元／PostgreSQL 驗收已完成；真實 KVM gate 尚未通過，詳見 [evidence](evidence/m3-https-provider-2026-09-24.json)。

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
- `mock-https-complete` 的 real-KVM acceptance 已嘗試，使用本機 TLS mock 與 profile check，沒有真實 provider API。該次 managed launcher 未帶文件要求的 `sg kvm` supplementary group；`/dev/kvm` open 得到 `EACCES`，sandboxd 的 Cocoon clone 子程序遭終止，KVM case 未通過。
- 開始前原有 197 筆 release proof 全部符合 exact stop-proof contract。失敗嘗試另外留下 1 筆 `allocate=started`、無 handle／observed/release proof 的 journal intent。收尾無 live claim、VM、failed-clone runtime directory 或 CPU cgroup；connector、sandboxd、測試 PostgreSQL 均已停止／移除。但產品 `drained()` 會因這筆未知 allocation 拒絕通過。歷史 journal／fences 保留，測試產生的新 intent／fence 也保留；沒有手工修改或刪除。不能刪除此 row、換 state directory 或重設 generation 來重跑。
- [M3-RECOVERY](M3-RECOVERY.md) 對未知 allocation／缺少 ownership 證據的行為是 quarantine 並要求管理員對帳。inspect 仍是唯讀；沒有 handle 時回 `allocation_ownership_uncertain`。有 handle 的 release 仍要已保存的 observed VM 與完整停止證據。沒有 handle 的 `allocate=started` 現在只能用 `agent-platform reconcile-unconfirmed-allocation` 在同一 journal 留下對帳決定。這個命令還沒在那台 KVM 主機上對 2026-09-24 的那筆 intent 執行，KVM acceptance 仍未通過。不得刪除該 row、換 state directory、降低 generation，或改用 direct driver。

2026-09-27 舊 journal 已不在重灌後的機器上，因此改用新的 state directory。`kvm8745` 上 `mock-https-complete` 與 isolation 皆 succeeded，結束時 VM／claim 為零。沒有使用者提供的 endpoint／credential 前，不做真實 provider smoke。24 小時實機停留留到 release 前整合測試；目前 profile deadline 最長 2 小時。
