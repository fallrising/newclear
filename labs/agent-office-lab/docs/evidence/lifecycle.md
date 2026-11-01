# OpenCode 生命週期驗收

2026-10-31，T-0004；AC-05、AC-08 的 OpenCode 子集已實測通過。[欄位白名單摘要](lifecycle-2026-10-31.json) 保留原始 result hash、runtime 來源 hash、兩次先前失敗及成功結果；原始 session、token、終端紀錄與截圖只留本機。

| 驗收 | 實際結果 |
| --- | --- |
| 原生權限等待與回覆 | 兩次 edit 都進入 needs_input；確認產物尚不存在、再等待一秒仍未寫入，經原生 PTY Enter 選 Allow once 後繼續並完成。未使用 Allow always。 |
| 真瀏覽器 refresh | lite 頁面實際 reload，PID、session、usage、原產物 mtime 不變，無新 working 事件；不是只開第二個 WebSocket。 |
| 真正程序 resume | 終止原 OpenCode 程序，原生 exited 事件及所屬 PID 退出通過；明確 worker.resume 啟動新 PID，同一 session 載入歷史 usage／TUI 後才發下一任務。 |
| 恢復後新任務 | 再次要求 edit 權限，resumed.json marker／sum 正確；原 result.json 未重寫。output usage 由 209 增至 340。 |
| 時間與資源 | 64.30 秒；全程 pressure level 1、swap 增量 0；原資源 guard 未放寬。 |
| 清理 | runner cleanup_errors=[]、Office cleanup_completed=true，測試服務已停止。 |

已執行 12 項 Node tests、3 項 Python configuration tests；publication／語法／本地連結及 repo indexes 通過。CI 亦執行這些元件檢查。上游來源未修改，沒有重跑 614 項上游測試。

## 保留的失敗與修正

1. 第一次真實測試觀察了未被 HTTP router 呼叫的 legacy handleOpenCodeHook，收不到權限要求。檢查路由後停止並保留 failed／interrupted 紀錄；改觀察實際 handleProviderHook，先交給原生身份驗證與狀態處理，再只記錄 accepted 的 OpenCode 事件。回歸測試驗證參數與結果完全傳遞、拒絕的事件不計入。
2. 第二次已通過權限與 refresh，但 browser／恢復 TUI 重疊期間持續 memory warning，資源 guard 正常停止。另發現原生 worker 的 idle 可以早於 TUI 就緒，過早送入的後續 prompt 沒有開始。修正為 refresh 後關閉測試 browser，等待同 session 新的 authenticated usage snapshot 與 TUI 畫面才送 prompt。未以固定延遲猜就緒，未放寬資源門檻。

## 範圍與重跑

依 [SETUP](../SETUP.md) 執行 `--harness office-opencode --check-lifecycle`。此旗標只用於合成測試，自動回覆已識別的 edit／bash 權限、最多八次，保留模型與 OS sandbox；未知或重疊要求失敗。一般 demo 設定不變。測試再次驗證了原檔案任務，但不代表所有權限類型／question UI 或其他 provider 已通過。

固定上游的 Office host restart 仍會在 Workers.start() 呼叫 wakeAll，自動恢復 worker，與 SDD 的 interrupted／手動恢復契約不同。**AC-08 整體仍 pending**；此處的程序 resume 不等於 Office host restart。AC-05 亦僅有 OpenCode 寫入權限子集，Grok／Pi 待驗。完整 OS egress／讀取邊界仍未驗收。

來源：[OpenCode 1.19.5 權限 TUI](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/tui/src/routes/session/permission.tsx)、[固定 Office manager](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/server/workers/manager.ts)。

後續 T-0005 已補上 lab host 中斷／手動恢復 adapter，見[重啟實測與範圍](restart.md)；本頁保留 T-0004 當時的結果與限制。
