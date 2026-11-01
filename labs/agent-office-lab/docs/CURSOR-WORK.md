# Cursor 登入後的有界任務

AC-13 已由 owner 第三次獨立授權的真實任務通過：Composer 2.5、15.57 秒，原生 session／模型、三次工具完成、completed stop、用量、精確產物及清理一致。[成功證據](evidence/cursor-completed-2026-11-01.json)。本次單次授權已使用，沒有自動重跑；後續付費任務仍須取得新批准。

## 執行範圍與命令

```sh
python3 scripts/run_cursor_work.py
python3 scripts/run_cursor_work.py --check-account
python3 scripts/run_cursor_work.py --check-startup
# 僅有新的單次付費授權才執行：
python3 scripts/run_cursor_work.py --allow-remote --timeout-seconds 240
```

無旗標只列計畫。`--check-account` 只讀原生登入布林值。`--check-startup` 使用隔離 auth 副本，允許原生啟動需要的 HTTPS metadata，不傳 prompt，beforeSubmitPrompt 也拒絕提交；這不等同於完全斷網的[未登入啟動](CURSOR.md)。

- 固定模型 Composer 2.5，一個合成 prompt、一次啟動、零 host 自動重試。
- 最多四次工具操作：先 Read(input.json) 一次、Write(result.json) 恰一次，另容許 Read(result.json) 最多兩次。output 預建為空 JSON object；每次須完成且 tool_use_id 相符後才可開始下一次。
- 寫入最多 4096 bytes。其他工具、路徑、symlink、子 agent、後續 prompt 及額外終端輸入均拒絕。
- 預設 120 秒，`--timeout-seconds 240` 可用於獲准的 240 秒任務；清理可能另用最多 22 秒。
- Provider request、token、金額硬上限均為 `null`。一個 prompt 不等於一次 API 請求；可能消耗訂閱配額或產生費用。原生服務重試不在 host 零重試承諾內，停止本機程序不能保證服務端即時停止計費。

## 驗收與隔離

必須有同一 session／固定模型、一次 prompt、兩至四個全部成功且含唯一寫入的工具事件、原生 `stop.status=completed`、`loop_count=0`、正數 output tokens 及精確產物 hash。Office 的 done 或終端文字本身不足以判定成功。`loop_limit=1` 允許初次 stop 執行；不回傳 followup_message，後續 prompt 仍由 gate 拒絕。

Wrapper 先核對固定 runtime hash，再以其封裝內的純 schema validator 檢查最終合併 hooks；配置無效或固定封裝布局改變就拒絕啟動。validator 在隔離 VM 執行，並確認 loop_limit=0 反例確實失敗。Hook 契約依[官方文件](https://cursor.com/docs/hooks)與固定 CLI 程式碼核對，設定 failClosed=true；handler 異常以阻擋回應與 exit 2 結束。

使用原生 workspace hooks 與明確 Read／Write 權限，沒有 --force／--yolo。--trust 僅信任新建合成 workspace。OS 限制區外寫入與非 HTTPS 外網，允許 Office loopback；完整檔案讀取／egress 隔離尚未驗證。只複製 owner auth，不複製設定、plugins、MCP、rules 或 host-switch state；結束後刪除副本，不修改原 auth。登入失效時失敗，不切換帳號或模型。

## 真實結果與保留的失敗

1. [首次任務](evidence/cursor-live-2026-11-01.json)：產物正確，但 lab 誤設 stop.loop_limit=0，整份 hooks 被原生 CLI 忽略，沒有事件／用量／工具邊界證據。修正為 1 並加入原生 schema 預檢。
2. [第二次任務](evidence/cursor-bounded-2026-11-01.json)：owner 允許翻倍額度；runner 用 240 秒但保留兩次工具限制。第一個 Read 成功，第二個 Read 被拒，34.05 秒後停止；未記錄目標，不能事後斷言原因。隨後加入四次工具範圍、預建 output 與檔案分類診斷；65 項離線測試及無 prompt 啟動通過。
3. [第三次任務](evidence/cursor-completed-2026-11-01.json)：新的單次批准後，Read(input) → Read(result) → Write(result) 全部通過；15.57 秒，原生 stop 回報 37723 input／424 output tokens，artifact hash 與清理一致。請求數與費用未知。此輪確實讀取了輸出檔，但不能反推第二次未保存的目標。

原受測來源 hash 全部保留。成功後僅修正 Office 子報告未更新的 model_inference_verified 欄位；父 runner 在原實測中已獨立驗證並回傳 true，沒有因這個報告欄位修正重跑模型。AC-13 通過不代表 Cursor 取消、權限互動、refresh、restart/resume 或四工位 MVP 已完成。
