# AT-11-C1：固定 fixture 的保守預算預留與結算

此切片在 AT-11-B 的 guest mailbox 與同一 ModelProxy ledger 上，新增**明確 opt-in 的合成 fixture credits**。它驗收並行請求的預留、合法用量的結算、未知用量的保守占用與額度截止後的原 VM 收尾。**Credits 不是法幣或供應商帳單；真實金額仍是 unknown，`hard_money_limit_supported` 仍為 false。** 完整 AT-11-C、AT-07、M3 尚未完成。

## 為何先用 fixture credits

既有 fixture 回報 `prompt_tokens`／`completion_tokens`，但這不是已驗證的真實 provider tokenizer 或費率。不能僅填入單價就宣稱硬金額上限。此切片只對受控本機 fixture 建立固定計量契約：一筆請求的輸入計量不得大於送出的 canonical JSON bytes；輸出計量不得大於已限制的 `max_tokens`。這是**本 fixture 的合成計量上界**，不可套用到其他模型或供應商。回報值超界時整筆記為 unknown，保留預留額度。

管理員可在原本的 0600 `MODEL_PROXY_CONFIG` 加入以下欄位；未加時維持 AT-11-B 的 request cap 和原政策 digest：

```json
"fixture_budget": {
  "revision": "fixture-credit-2026-09",
  "limit_microcredits": 10000000,
  "input_microcredits_per_token": 1,
  "output_microcredits_per_token": 1
}
```

此範例數值只供測試。`revision`、上限、單價與既有 endpoint／credential fingerprint 一起釘在 run policy；輪替 token、worker 接管或修改配置都不能重設、提高或重新計價既有 run。`010_fixture_budget.sql` 只增加獨立的 fixture credit 欄位；原本 `amount_decimal`、`currency`、`price_revision` 仍由 SQL 約束為 null。

## Admission 與故障語意

1. 在原 job → run 鎖及 live ownership／binding 檢查之內，先算 `input_bound × input_rate + output_bound × output_rate`。本 run 所有 final 列以已結算值計入；reserved／unknown 列以完整預留值計入。若新預留超過上限，拒絕 dispatch，回 `model_fixture_budget_exhausted`。不同 request ID 的並行請求由同一 run lock 序列化。
2. 預留與 request UUID／payload hash 一起 commit，之後才做上游 I/O。429、timeout、損壞回覆、超出上界或 SIGKILL 後未知 dispatch 不退款、不重送；`reserved`／`unknown` 永久以完整上界占用本 run 額度。
3. 合法 fixture 回覆才按已驗證 counters 結算；結算再次比對原 policy digest，不能用新價格修訂舊請求。取消／pause 之後仍保存已 admission 的用量，但撤權 completion 不交付。Terminal 工具 gate 預先要求足夠容納下一筆最大允許 fixture 請求，可能保守地提前截止；額度錯誤沿用 AT-11-B 的 durable cutoff、token 撤銷、interrupt／VM stop，完整停止證據前保留 resource reservation。
4. Usage API 分別顯示 `fixture_credit_limit_microcredits`、`fixture_credits_committed_microcredits`、不確定狀態及逐筆上界／預留／結算。`cost_status: unknown`、真實 `amount_decimal: null`、`hard_money_limit_supported: false` 保持不變；Web usage capability 仍關閉，避免將合成 credit 顯示成真實帳單。

## 部署、驗收與後續

沿用 AT-11-B 的完整 drain／DB 備份與 API、worker、connector 同步升級流程，再套用 migration 010。既有 journal／fences／generation 原樣保留；不重建 launcher 或 OCI template，不原地更新 active guest。既有 deny-all sealed node、host 拉取 guest mailbox、控制端 fixture credential、無 guest 私網例外與無 host shell fallback 均保持原安全邊界。

一般測試涵蓋並行先預留、429／超界保留全額、工具 gate、政策漂移不得重算、舊政策 digest 與原控制案例。真實 KVM 驗收包含兩次請求成功結算、預算不足時零上游 dispatch、超界回報保留全額，以及 durable cutoff／完整 VM／claim 清理；另回歸 AT-11-B 原 13 案。公開結果見 [AT-11-C1 evidence](evidence/m3-fixture-budget-2026-09-23.json)，私有原始 payload／logs 留在 repo 外。

```bash
make platform-check
python scripts/test-postgres.py python scripts/m3-guest-model-kvm.py \
  --config /private/connector.json --origin http://127.0.0.1:17888 \
  --output /private/new-acceptance-directory
```

下一步 AT-11-C2 必須先取得可核對的真實 provider 價格版本、token 上界與明確 operator opt-in，才可加入真正 `amount_decimal`／硬金額上限；否則保持 request／time 限制與 unknown cost。其後再接 usage UI 和獨立 opt-in provider smoke，不讀取主機既有 provider key 作默示授權。自然語言 coding、streaming、M4 artifact／export／backup／GC／production 仍未完成。
