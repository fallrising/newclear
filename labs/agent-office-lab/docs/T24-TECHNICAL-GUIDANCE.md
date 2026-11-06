# T-0024：Claude 技術指導與 Pi 委託

狀態：Claude 指導、兩個 Pi worker 平行實作與主導 agent 整合驗收完成。Owner 已於 2026-11-07 批准費用條件並更新憑證。Owner 指示由 Claude Opus 5.5 提供技術指導，Pi agent 分工實作；主導 agent 審查、測試、整合及 GitHub 交付。

## 模型與執行紀錄

已實際呼叫 Claude Code 2.1.316，回應模型為 `claude-opus-5-5`／firstParty，單次唯讀、無工具、沒有 fallback。只送出公開主線的七個來源檔，逐檔核對與 origin/main 相同；沒有傳送 runtime、登入檔或私人任務。Claude 成功產生指導。模型回報的清單價成本為 0.8233818 美元，不代表實際訂閱帳單。

更新 key 後，兩個實際 Pi 1.4.0 CLI 使用既有 `openai/gpt-5.5` 設定平行執行，未替換模型。後端產出十個檔案、24 次請求／37 次工具呼叫、回報成本 1.689313 美元；到達請求上限後停止（exit 77），主導 agent 接手補齊測試與修正。介面產出四個檔案、20 次請求／20 次工具呼叫、回報成本 1.025835 美元，正常結束。兩者均在原有限額內，沒有追加 worker 重跑。開發 API 用量不代表產品 Pi／DeepSeek 已驗收，也沒有使用本地 Strata。

先前第一個 worker 因過期 key 回 401、零模型用量，第二個因自動審核要求費用門檻明確批准而未啟動；owner 的本次批准與 key 更新已解除這兩項阻擋。

## 本里程碑範圍

只先實作固定 Pi／DeepSeek 合成任務的遠端操作台授權、派工、停止及結果。遠端原生終端、任意 prompt、多檔專案、遠端重試與 Grok／Cursor 授權延後。產品真實遠端模型驗收與開發 agent API 費用是兩種不同授權；本輪實作 agent 不得啟動產品付費任務。

CLI 建立具有效期的一次性 grant，console 另外以 `--accept-remote-grant pi` 明示接受。Grant 存在私有 state 目錄，綁定 provider、固定模型／版本、限制與來源雜湊。讀取拒絕連結、非 regular file、錯誤 owner／mode、重複 JSON key、超量或無效欄位。持久化 consumed／revoked 紀錄，重啟不重置授權。

Dispatcher 在共用執行鎖內通過預檢後，原子消耗 grant 再啟動 runner。預檢失敗或忙碌不消耗；消耗後啟動失敗也不退還。沒有 HTTP 端點可以建立、延長或改寫 grant。費用沿用請求／token／時間限制，不能宣稱金額硬上限。

## 固定介面契約

- `GET /api/state` 新增 `remote_grants={enabled_providers,pending,errors}`。公開摘要只有 provider、fingerprint、task、model、expires_at、limits，不含原始 grant id、路徑或憑證。
- 原有 Pi task 計畫回傳 `plan.authorization`，分為 `server_grant`（指紋、到期）或 `cli_required`（原因）。只有有效 server grant 的固定 fresh Pi task 可執行，遠端 retry 不可套用。
- 原始 grant id 只留在 server plan。計畫最多五分鐘，不能超過 grant 到期。執行前重查相同 grant、來源與共用鎖。
- Execute body 保持精確 `{plan_id}`；頁面額外確認只防誤觸，不能建立授權。Console argv 使用 `--remote-grant`，不直接加入 `--allow-remote`；dispatcher 消耗後才構造 runner 的遠端參數。
- Job 回傳 remote、authorization_fingerprint、authorization_consumed。消耗狀態由磁碟重查；無法確認時回 null，不因 Popen 已啟動就假設已消耗。
- 結果只增加嚴格白名單 authorization 指紋與 remote_usage 數量（中斷且用量不明時 output_tokens 為 null）；停止、失敗或測試替身不能標為成功。

## Pi 分工

A 負責 `remote_grant.py`、`office_dispatch.py`、`office_console.py`、`run_pi_work.py`、`office_results.py`、`console_grant_harness.py` 及相關 Python 測試。B 負責 `office_console.js`、`office_console.html`、`office_console.css`、`check_console_remote_grant_browser.mjs`。兩者使用獨立工作區，沒有共用可寫檔；不修改文件、任務板、vendor 或 Git 紀錄。

Worker 只具備分配檔案的 read／edit／write，沒有 shell、MCP、產品執行或自行部署權限。主導 agent 執行測試並整合。每個 worker 最多 24 次請求、80 次工具呼叫、每次 6000 output tokens、12 分鐘；回報費用累計達 3 美元後停止，此為回應後停止門檻，並非預付硬上限，owner 已於 2026-11-07 明確批准。

## 驗收

1. Grant 建立、過期、撤銷、source／limits 篡改、重複 key、連結／owner／mode／大小拒絕；競爭消耗只有一次成功。
2. Dispatcher 預檢與鎖失敗不消耗；成功後無退款；拒絕混用遠端旗標、retry 或其他模式。
3. Console 預設拒絕、opt-in 無 grant 拒絕、一次性 plan、撤銷及替換 grant 拒絕、所有 HTTP 回應不洩漏 id。
4. 僅用暫存 lab 的本機 stub harness 驗證介面確認、重複點擊、刷新、停止、結果、撤銷、重啟及零外部請求。Stub 明確標示失敗／未推論，不偽造模型成功。
5. 實際 checkout 不建立 grant，回歸 Pi 本機 429／取消；保留既有 195 項測試、publication 與全倉索引檢查。
6. 真實遠端產品驗收另需 operator 明確授權，完成前 AC-01／09 及完整 MVP 維持 pending，沒有 usable tag。

## 後續順序

遠端 UI 一次真實授權驗收 → Pi 權限互動（本機 scripted responder，清楚標測試替身）→ 綁定來源的遠端重試 → Grok／Cursor 取消／故障 → 完整路徑、hooks、憑證與 egress 驗收 → 遠端終端互動。各項仍按實際驗收證據判定。

實際驗收與先前失敗保留於[白名單證據](evidence/remote-grant-2026-11-07.json)。主導審查修正了 retry 誤套 fresh grant、schema／連結／目錄權限、來源綁定、消耗後缺少 audit receipt、用量未知誤標零及瀏覽器清理與斷言問題。218 tests、Chrome、真實 Pi 本機回歸及歷史結果均通過；沒有產品付費請求。
