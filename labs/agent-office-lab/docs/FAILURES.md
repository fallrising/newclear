# Pi 故障驗收

真實 Office PTY、Pi 1.4.0 與原生 hooks 接收**本機注入**的 HTTP 401 或 429。端點沒有 owner API key，不建立外部模型連線；Pi worker 仍受 OS 外網拒絕限制。這驗證錯誤處理，不是 DeepSeek 推論或實際帳號／服務異常的證據。

```sh
# 只顯示計畫
python3 scripts/office_dispatch.py run pi --check-failure 401

# 真實啟動 Pi，接收本機錯誤回應；兩次依序執行
python3 scripts/office_dispatch.py run pi --execute --check-failure 401
python3 scripts/office_dispatch.py run pi --execute --check-failure 429
```

不需要 Pi 登入檔，但仍需 [SETUP](SETUP.md) 的固定 Pi／Office 安裝、macOS arm64 與 loopback／PTY 權限。`--check-failure` 只適用於 Pi，不可與 `--allow-remote` 或 `--check-cancel` 混用。直接 runner 的 `--check-failure` 入口也受同一個執行鎖約束；不會自動重試或放大預算。

每筆驗收必須同時滿足：一次本機請求、零上游模型請求、同 session／model 的 `assistant_end(error)` 與 `agent_settled`、authenticated error hook、原生工位 `needs_input` 且從未顯示 done、無工具／輸出 token／產物、完整清理。故障驗收成功時命令退出 0，但報告仍為 `status: failed`、`model_inference_verified: false`，另以 `failure_check_passed: true` 表示測試通過；不能把命令退出 0 當成模型任務完成。

正常付費模式也保留服務端 401／429 的 HTTP 類別，其他非 200 回應轉為 502；回傳固定錯誤說明，不轉傳服務端原始錯誤內容或 headers。任一失敗會停止 relay 的後續轉發；Pi 的原生 retry 設定仍為 disabled／0。

Pi runner 追蹤 Office 程序樹，保存 PID 與 `ps` 啟動時間，對重掛父程序的子程序繼續觀察；清理後等待最多 10 秒確認所有已觀察到的所屬程序退出。身分不符不採認為原程序，無法取得有效程序快照則不宣稱清理完成。仍有程序時，故障驗收不通過並保留執行阻擋。這是輪詢到的所屬程序證據，不能代替完整 OS 隔離或其他 provider 的生命週期驗收。

[本輪實測](evidence/pi-failures-2026-11-01.json) 保留四次 run：最初兩次原生錯誤判定通過，但缺完整程序樹退出證據，其中 429 的外層觀察在 runner 結束時仍看到一個子程序。修正後的 401／429 各有一次本機請求、零外部模型請求，內外兩層觀察均確認程序全退出，執行鎖釋放。結果入口會將缺新清理證據的舊紀錄標為故障測試未通過；保留原始報告。

[結果頁](RESULTS.md) 明示「本機注入 HTTP 401／429」，所有四筆任務仍顯示失敗。最終兩筆才顯示故障測試通過。135 項離線測試及瀏覽器核對通過；沒有載入本地模型或呼叫遠端模型。

完整 AC-07 仍 pending：CLI crash、其他 provider 的錯誤、至多兩次顯式重試的產品流程尚待驗。Pi 的真實服務推論與其他生命週期仍沿用各自既有證據，不以本測試取代。
