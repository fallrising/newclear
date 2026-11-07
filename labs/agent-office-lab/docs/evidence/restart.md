# Office host 重啟與手動恢復

2026-10-31，T-0005；AC-08 的 OpenCode host 子集通過。[公開欄位摘要](restart-2026-10-31.json) 保留原始結果與受測 runtime SHA-256；登入資訊、session、終端紀錄及截圖只留本機。完整三 provider AC-08 仍 pending。

| 驗收 | 實際結果 |
| --- | --- |
| 真正 host crash | 原生 edit 權限等待且產物不存在時，SIGKILL 獨立 Office host；沒有執行其 shutdown handler。 |
| 首次重啟 | 同 workspace／home／port 的新 host 停止殘留 PTY；舊 OpenCode 所屬 PID 全退出，零新 worker PID、零產物，狀態為 offline／interrupted。三秒後再核對仍不執行。 |
| 再次重啟 | 正常停止中斷中的 host，再啟動第三個 host，原 session／worker 與 interrupted 狀態保留。 |
| 真瀏覽器恢復 | lite 工位可見 `interrupted ·`；點開離線工位才送出原生 worker.resume。恢復接線等同 session 的 authenticated usage 與新終端就緒，透過原生 PTY 送出一次繼續指令。 |
| 原 session 完成 | 再次要求 edit 權限；合成測試經原生終端 Allow once 後完成，session 不變、marker／sum 正確、hash 已保存。 |
| 完成後重啟 | 第四個獨立 host 沒有啟動 worker，任務仍為 completed，產物 mtime 不變。 |
| 時間／資源／清理 | 91.22 秒；pressure levels 1、2（未達連續 warning 門檻）、swap 最大增量 0；guard 未放寬，cleanup_errors=[]。 |

既有 `--check-lifecycle` 回歸亦通過（62.96 秒）：兩次 edit／Allow once、真瀏覽器刷新不重跑、新程序同 session、第二個產物正確，output usage 243 → 415。回歸先前有一次 swap guard 停止，已保留於摘要；清理及資源回穩後才重跑。

23 項 Node 與 3 項 Python 測試通過，涵蓋 active／waiting／completed、重複重啟、正常關閉的未完成狀態、損壞 journal 拒絕、阻止原生自動恢復、local-only、恢復時的身份驗證／TUI 就緒與避免重複輸入。正常關閉 active 任務的分支在離線測試驗證；真實強制中斷選用權限等待點。

## 實作及保留的失敗

固定上游原本會 adopt 存活的 PTY 並 wakeAll。lab adapter 在 startup 停止舊 PTY、停用自動喚醒，將 `.agent-office/lab-recovery.json` 中未完成的狀態恢復為 interrupted；正常 shutdown 先保存中斷狀態。上游原始碼未修改，adapter 明確要求固定 commit，依賴其內部介面。

本輪保留三次先前失敗，全部清理無錯誤：

1. 驗收腳本把 owners() 的離線工位資料列誤算為運行中程序，修正為只檢查有 PID 的列。
2. 一次執行的 swap 增量超過 1 GiB，原 guard 停止測試。確認無殘留大型程序、pressure 恢復正常後才重試，未改模型、context 或門檻。
3. 已通過中斷與重複重啟，但手動恢復只載入 session。確認 [OpenCode 1.19.5 home route](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/tui/src/routes/home.tsx) 才會自動提交 `--prompt`；既有 session 沒有提交。停止測試後補上就緒接線：先原生身份驗證、同 session usage 與新 TUI，再一次原生 prompt；30 秒未就緒停止並保留 interrupted，其他原生操作先開始時取消待送指令。

## 範圍

依 [SETUP](../SETUP.md) 執行 `--harness office-opencode --check-restart`。只使用本地 Strata、合成 workspace 與固定 OpenCode；驗收中的權限自動回覆有界且僅選 Allow once。恢復接線本身不會代替使用者回答權限要求。

新 runner 每次建立新 run；這次測試是在同一 run 內重啟 Office host，不代表整個 Strata／runner 重啟後可跨 run 自動找回任務。讀取／egress 完整隔離、Grok／Pi、其他故障情境與三工位產品流程仍未驗收；沒有 usable tag。
