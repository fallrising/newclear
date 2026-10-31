# Cursor 登入後的有界任務

Owner 已完成隔離登入，原生 `status --format json` 回報 `isAuthenticated=true`；唯讀 catalog 包含本輪固定模型 `composer-2.5`。帳號、token 及 catalog 原始輸出不公開。這不等於已完成 AC-13，也不代表已批准模型用量。

本輪準備一個原生 Office PTY 任務：讀取合成 input.json，將 marker 與數值總和寫到 result.json，然後結束。只有 `--allow-remote` 才送出固定 prompt。

```sh
python3 scripts/run_cursor_work.py
python3 scripts/run_cursor_work.py --check-account
python3 scripts/run_cursor_work.py --check-startup
# 只有取得 owner 明確的本次配額／付費批准後才執行：
python3 scripts/run_cursor_work.py --allow-remote
```

無旗標只列計畫。`--check-account` 只印登入布林值。`--check-startup` 使用已登入的私有 auth 副本與全新 HOME，允許原生啟動需要的 HTTPS metadata，但不傳 prompt，且 beforeSubmitPrompt 拒絕提交；它與完全斷網的[未登入啟動](CURSOR.md)不同。先前完全斷網的已登入啟動回傳原生 internal error；這次保留該失敗紀錄，沒有將它算成成功。

## 待批准範圍

- 模型固定 Composer 2.5，一個合成 prompt，一次啟動，host 不自動重試。
- hook 只允許 Read(input.json) 一次，再 Write(result.json) 一次，寫入最多 4096 bytes；其餘工具、其他路徑、symlink、子 agent 與再次提交均拒絕。
- 120 秒期限，失敗或邊界拒絕時停止 Office 及本輪追蹤程序；清理可能再用最多 22 秒。停止本機程序不能保證服務端即時停止計費。
- CLI 沒有本 runner 可保證的 provider request、token 或金額硬上限，均記 `null`。可能消耗訂閱配額或產生費用，不能把一個 prompt 說成一次 API 請求，也不能把工具／時間上限當作金額上限。原生服務重試亦不在 host 的零重試承諾內。

使用原生 workspace hooks 和明確的 Read／Write 權限；沒有 `--force`／`--yolo`。`--trust` 只信任新建合成 workspace。OS 限制區外寫入與非 HTTPS 外網，容許 Office loopback；模型的工具路徑由 fail-closed hooks 驗證，不宣稱完整檔案讀取／egress 隔離。只複製 owner auth，不複製設定、plugins、MCP、rules 或 host-switch state；執行結束刪掉 auth 副本，不修改原 auth。登入 token 若失效，明確失敗，不自動換帳號或模型。

## 成功判定與缺口

同一 session／固定模型、一次 prompt、兩個成功工具事件、原生 `stop.status=completed`、`loop_count=0`、正數 output token 證據及產物內容／hash 必須一致。Office 的 `done` 本身不足以成功，因上游 Cursor adapter 沒有保留 stop 的錯誤狀態；lab 額外保存白名單原生 stop 狀態。沒有 followup_message，hook 也設 loop_limit=0。

Hook 契約依[官方 hooks 文件](https://cursor.com/docs/hooks)及固定 CLI 封裝程式碼核對：beforeSubmitPrompt／preToolUse 可阻擋，stop 提供完成狀態與用量。所有 handler 拒絕錯誤輸入，異常返回阻擋 exit code 2；設定 failClosed=true。離線測試不能替代真實模型工具回圈的驗收。

[已登入無 prompt 啟動證據](evidence/cursor-ready-2026-11-01.json)與 33 項 Node／30 項 Python 測試通過；沒有執行 `--allow-remote`。AC-13、真實 hook round trip、模型任務、產物及其餘生命週期仍 pending，PR 保持 draft 等 owner 批准一次上述驗收。
