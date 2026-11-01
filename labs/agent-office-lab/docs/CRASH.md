# Pi CLI 崩潰與重新啟動驗收

本機 relay 留住第一個請求，真實 Pi 在 `working` 時由 runner 對其原生 CLI 注入 SIGKILL。relay 不載入 owner API key、不建立上游模型連線；Pi 的 OS 外網拒絕設定仍生效。這測試程序崩潰，不是 DeepSeek 推論或原生取消。

```sh
# 預設只顯示計畫
python3 scripts/office_dispatch.py run pi --check-crash

# 明確執行一次 crash 驗收
python3 scripts/office_dispatch.py run pi --execute --check-crash

# 確認前次清理完成後，明確啟動全新無 prompt session
python3 scripts/run_pi_work.py --check-startup
```

只支援固定 Pi／Office runtime；不需要登入檔。`--check-crash` 不可與 `--allow-remote`、`--check-cancel`、`--check-failure` 混用，直接 runner 也受共用執行鎖限制。重新啟動是另一個明確命令，不是自動重試、恢復原 session 或重送任務。

只有原生工位已 `working`、同 session hooks 正確且本機第一個請求已留住，才產生 crash 目標。目標檔以原子 rename 交接；runner 再核對它是已觀察到的所屬程序，且 PID／`ps` 啟動時間仍相同，才送一次 SIGKILL。它不按程序名稱搜尋或批量終止；這種輪詢與 PID 核對仍有 OS 時序限制，不宣稱為安全隔離邊界。

通過條件包含：同 session 的原生 `exited`、從未 `done`、無工具／assistant 回應／產物、一個本機請求及零外部請求、退出後至少三秒沒有新 session 或 worker、所有已觀察到的程序退出後才釋放執行鎖。命令退出 0 表示測試通過，模型任務仍為 `failed`，另記 `crash_check_passed: true`。結果頁明示「本機注入 CLI crash」。

固定上游 PTY 在 SIGKILL 後可能回報 exit code 0；這不代表任務成功。驗收依實際注入訊號、原生 `exited` 事件與無完成／產物證據判定，不把退出碼單獨當作成功條件。

本機保留每次 run、原始事件與受測來源摘要。清理無法確認就保留執行阻擋，不自動承認中斷；人工解除的條件見 [DISPATCH](DISPATCH.md)。`--check-startup` 必須在新 session 到達 idle、沒有 prompt、沒有任何 relay 請求且完整清理後才通過；結果頁顯示啟動檢查，不列為模型任務完成。

本次驗收範圍是 AC-07 的 Pi 執行中 CLI crash，以及 AC-08／09／11 的不自動重跑、明確重新啟動與結果分類子集。host crash、原 session 恢復、其他 provider 的 crash／取消、至多兩次顯式任務重試及完整 MVP 仍待驗。

[本輪證據](evidence/pi-crash-2026-11-01.json) 保留初次 crash、原子交接修正後 crash、明確新 session 啟動三筆。最終 crash 與啟動各追蹤 40／38 個程序且全部退出；crash 僅一個本機請求、啟動零請求，均無外部模型呼叫。141 tests 及 43 筆結果的四 provider 產物／故障來源／啟動分類／刷新瀏覽器檢查通過。
