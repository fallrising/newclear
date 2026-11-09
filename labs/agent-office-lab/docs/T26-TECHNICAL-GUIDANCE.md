# T-0026 技術指導與分工

維持 owner 指定的 Claude Opus 5.5 技術指導 → 兩個實際 Pi CLI（OpenAI GPT-5.5）分工 → 主導 agent 審查、整合、驗收及交付。

第一次 Claude 調用提供 12 個公開來源，240 秒逾時且沒有返回指導／用量；保留失敗，費用未知。經明確批准後縮小為一個公開 policy 來源及主導已核對的上游契約摘要，第二次 119.15 秒完成，回報估算 0.299861 美元。不是帳單，不能將未知用量算成零。

Claude 建議把初始 session 與啟動世代綁定、重新連接需明確預告，拒絕外來 session 的 starting 及重複 start；在真實 HTTP 入口比較拒絕前後狀態。主導核對固定上游後修正：`handleProviderHook(route, id, token, event, payload)` 同步回傳布林值；`authenticate(id, token)` 回傳原工位 info。未知 worker／policy 拒絕皆沿用 401，壞 JSON 是 400，未知 route 是 404。不能用 Promise 作為布林成功值，也不在每次 UI 的 done 後永久封鎖事件。

## 凍結契約

`installPiHookGuard(manager)` 安裝於 `onePiTask`、報告 observer 之前。新工位成功 spawn 後 `expectFresh(id)`；明確一次性 resume 消耗許可後、原生 launch 前 `expectReconnect(id, session)`。第一個合法 start 經原生接受才綁定 session；重新連接需要同 worker、同 session 與已輪替 token。型別／模型／route／存活 PTY／認證均在 native 呼叫前核對。沒有新 wire protocol、產品端點或 vendor 修改。

`probePiHooks` 使用真正的 `office.hookPort`，拒絕缺失／錯誤 token、未知 worker、錯誤／未知 route、壞 JSON／payload、外來 session／starting、重複 starting 與非空 event；resume 另驗舊 token。逐案比較完整工位 info、worker 數、token、PTY 存在與已接受 hook 數；快照只留在記憶體，公開只輸出案例名稱、HTTP 狀態及未改變布林值。Python 另以固定欄位、順序、型別及案例數重驗報告。

## 實際分工

- Pi guard：四個檔案，guard／policy／相關測試；15 次請求、17 次工具、176.69 秒，正常退出，回報估算 0.911526 美元。
- Pi probe：六個檔案，HTTP probe／測試、question／resume／startup 接線與來源清單；14 次請求、20 次工具、133.29 秒，正常退出，回報估算 0.988865 美元。
- 主導：修正 native 認證簽名、證據命名、避免錯誤訊息帶 token、外來 session 生成；加入 Python 白名單、身分／重入負向案例，執行實測並交付。

兩個 worker 在獨立 worktree，只有指定 read／edit／write，沒有 shell、MCP、vendor 或 Git 權限。各最多 24 次 provider-request hook、6000 output tokens／回應、80 工具、720 秒；回報費用達 3 美元後停止，最後回應可能超過門檻。臨時憑證副本已移除。已知回報小計 2.200252 美元，另有首次逾時未知用量；產品驗收零模型請求，未建立付費 grant。

來源：`fallrising/newclear` runtime 基準 `04a7340f05ade127f550539817f78411bfba9d2d`，固定 Agent Office `852e2ab28c4f3f31bffdf4b20353bd119c9d3270` 的 `src/server/workers/manager.ts`、`hooks/server.ts`、`providers/pi.ts`、`providers/opencode.ts`、`pi.ts`。實際來源 hash、保留失敗及原生證據見 [T-0026 證據](evidence/pi-hook-boundary-2026-11-07.json)。本地檢查與 runtime 見 [操作說明](PI-HOOK-BOUNDARY.md)，CI／合併狀態見任務板及 PR。
