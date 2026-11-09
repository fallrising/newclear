# Pi 原生確認介面驗收

本流程使用真實 Pi 1.4.0 與 Office 原生終端，執行測試專用指令，依序拒絕、接受、等待確認視窗逾時。回答由本機驗收程式送出，沒有模型 prompt 或 DeepSeek 請求；它驗證原生 UI 與等待狀態，不代表模型驅動的工具權限已通過。

## 執行

在 lab 目錄查看計畫，再明確執行：

```sh
python3 scripts/office_dispatch.py run pi --check-question
python3 scripts/office_dispatch.py run pi --execute --check-question
```

操作台的 Pi 工位提供「原生問答確認檢查」。查看計畫後啟動一次，重新整理只讀取同一份工作，不重送指令。驗收程式會透過已登入、已附接的原生 Office 終端送出固定測試指令及按鍵；操作台沒有新增自由輸入或任意命令 API。

模式只能用於 Pi，不能與付費執行、grant、重試、其他故障檢查或保留終端混用。不載入操作員的 DeepSeek key、不註冊任務重試，沿用共用執行鎖與完整程序清理要求。

## 核對範圍

- 真實 `ctx.ui.confirm` 產生原生開始／結束事件，經 authenticated hooks 進入 Office 的 `needs_input`。
- 同一 session 依序取得 `false`、`true`、`false`；最後一次由原生逾時計時器結束，沒有回答按鍵。
- 拒絕時沒有動作；接受後只寫一次測試 marker，逾時與重複測試指令不再寫入。
- Marker 在私有 run 的 `question/`，與模型產物 `workspace/result.json` 分離；runner 重算 hash、核對 nonce／session、事件順序與嚴格型別。
- Python relay 的請求計數必須全為零。Pi 的 `before_provider_request` 例外會被原生 CLI 捕捉，因此該 hook 只用於偵測；無憑證 relay 與既有網路限制才是避免外送的邊界。意外本機請求也會令本次驗收失敗。
- 結果以 `native_question_check` 標示，通過時保持 `stopped` 與 `model_inference_verified=false`；不能顯示為模型任務完成。Native UI 結束後的 `done` 狀態也不是模型成功證據。

本輪來源變更會使先前來源綁定的遠端 grant 失效；未來真實付費任務須在新版本重新授權。本流程本身不建立 grant 或消耗遠端模型額度。

AC-05 的模型驅動權限／問答及其他 provider 仍待驗；完整安全邊界、付費新入口端到端與遠端串流停止也未由此流程涵蓋。

## 本輪驗證

248 tests（197 Python、51 Node）通過；兩次真實 Pi／Chrome 驗收均通過、零請求，外層 43／35 個程序全部退出、沒有 active journal。67 筆唯讀結果回歸通過，操作台與離線頁都明確區分確認檢查與模型任務。[公開證據](evidence/pi-question-2026-11-07.json)保留兩次紀錄及離線測試修正。
