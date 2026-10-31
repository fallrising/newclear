# OpenCode 生命週期驗收進度

2026-10-31，T-0004；對應 AC-05、AC-08 的 OpenCode 子集。

已實作 `--check-lifecycle`：原生 permission hook 與終端畫面核對、Allow once 的 PTY 回覆、真正瀏覽器 refresh，以及終止 OpenCode 程序後透過原生 worker.resume 恢復同一 session、執行新任務。這是待實測的驗收程式，不是已通過的 runtime 結論。

已執行：

- Node tests 10／10 通過：原 5 個 local policy tests，加上 permission probe 的接受事件／畫面門檻、worker／session 隔離、單次回覆、重疊／未知要求與錯誤拒絕。
- Python configuration tests 3／3 通過：僅 Office 啟用 ask、保留本機 provider／sandbox、不改來源設定、不傳雲端金鑰，未知模式直接失敗。
- publication 語法／公開邊界／本地連結檢查通過；repo 索引檢查通過。
- 新路徑的 `--harness office-opencode --check-lifecycle --prepare-only` 通過；status=prepared，cleanup_errors=[]，沒有啟動推論。

**真實模型驗收尚未執行**：先前保持開啟的 demo 仍使用本機模型服務，等待決定是否停止該 demo 後獨占測試。未中止既有服務，也沒有把 prepare-only 算成推論成功。PR 保持 draft，AC-05／AC-08 仍 pending。

預定通過條件：真實原生 needs_input → working → done；回覆前產物不存在；refresh 前後 PID、session、usage 與產物 mtime 不變；終止後舊 PID 退出，明確 resume 後新 PID／同 session，原產物未重寫、新產物正確、usage 增加，且再度出現權限要求。

固定上游的 host restart 會在 `Workers.start()` 中呼叫 wakeAll，自動恢復 worker；與 SDD 的 interrupted／手動恢復契約不同，尚待另外處理。程序 resume 與 Office host restart 不混為一項成功。

來源：[OpenCode 1.19.5 權限 TUI](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/tui/src/routes/session/permission.tsx)、[固定 Office manager](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/server/workers/manager.ts)。
