# Grok 登入後有界任務

AC-03 已通過：owner 再次明確批准翻倍範圍後，Grok Build 1.0.70／grok-4.6 在 18.00 秒完成兩次讀取與一次編輯，原生完成、同 session 模型、成功工具結果、精確產物及清理一致。[成功證據](evidence/grok-completed-2026-11-01.json)。35 Node／46 Python tests 通過。本次單次授權已使用，後續付費任務仍須新批准。

## 命令與執行範圍

在 lab 根目錄執行：

```sh
python3 scripts/run_grok_work.py
python3 scripts/run_grok_work.py --check-startup
# 只有取得新的一次配額／付費授權後才執行：
python3 scripts/run_grok_work.py --allow-remote
# 本次成功驗收使用的翻倍範圍（重跑須新批准）：
python3 scripts/run_grok_work.py --allow-remote --budget-multiplier 2 --timeout-seconds 480
```

無旗標僅列計畫。單次任務讀取合成 input.json，讀取預建的 result.json，再用 search_replace 將空 JSON object 換成精確 marker／總和。只允許一個新 session、一個 prompt，不接受後續輸入、resume、額外工位、其他帳號或模型。

- 固定 grok-4.6；預設四工具 gate／六 turns／240 秒。顯式 `--budget-multiplier 2 --timeout-seconds 480` 改為八工具 gate／十二 turns／480 秒，仍只有一個 prompt／一次編輯、零 host 重試；清理另最多約 22 秒。
- hook gate 最多四次 read_file／search_replace，只有 input.json、result.json，必須先讀兩檔、只能編輯 result 一次，替換內容最多 4096 bytes。無歧義接受 target_file／file_path／path；兩檔讀取可並行、依 tool ID 個別核對完成，編輯必須等兩檔都讀完。拒絕多個路徑欄位、symlink、越界、重複 tool ID、截斷 payload 與邏輯工具錯誤。
- 原生參數限制六個 agent turns、只提供這兩種工具，停用 subagents、web、plan；dontAsk 搭配兩檔 Read 與 result Edit 規則，不使用 always-approve 或 bypassPermissions。
- **四／八工具是 hook gate，不是服務端硬上限。** Grok 的 hook 當機／逾時會 fail-open；handler 能捕捉的異常會明確 deny，但不能保證程序被殺或逾時仍阻擋。原生工具／路徑權限及 OS 寫入限制提供額外邊界。
- Request／token／金額硬上限均為 null。六／十二個 turns 不等於六／十二次 HTTP 請求；服務端重試、配額消耗及計費可能存在，停止本機不能保證立即停止遠端計費。

## 原生驗收契約

Wrapper 精確驗證 Office argv、UUID、隔離 HOME／GROK_HOME／GROK_AUTH_PATH，先用網路全拒絕的原生 `inspect --json` 確認 lab hooks 與 Office hooks 實際載入，且沒有外加 plugins／MCP。上游 --trust 只作用於新建合成 workspace。正式啟動允許 loopback、Unix socket 與 HTTPS；沒有完整讀取／egress 審計。

只複製已登入的私有 auth.json，不帶入 owner 設定、hooks、MCP、rules 或 plugins。原 auth 不修改，run 副本在 finally 清理；原始日志只存忽略的 runs。原生 CLI 可能下載內建 metadata／bundled resources，不能把隔離 HOME 說成完全離線或沒有內建內容。

固定 binary 的 SessionStart 不含 modelId，與目前公開原始碼不同。模型證據改讀同 session、同版本的原生 `model changed` 日誌；在 prompt／工具／完成時核對固定模型。非同 session 的 catalog、CLI 選擇字串或預設模型不能代替該證據。

真實成功需同一 session 的 authenticated Office hooks、正常 end_turn Stop、非 stop-hook continuation、全部工具成功、唯一編輯、精確 JSON／SHA-256 及清理。普通 PostToolUse 可能包含邏輯錯誤，因此只接受已知成功結果 shape；未知格式直接驗收失敗。清理引發的 Stop 單獨記錄，不能當作任務完成。此輪沒有獨立核對用量／費用，仍記 unknown／null，不能填零。

協定參考：[官方 hooks 文件](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)、[原生事件格式](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-hooks/src/event.rs)。這些原始碼只供契約研究；固定 binary 的 inspect／SessionStart／模型日誌已實測，工具回圈與正常 Stop 已由上述真實任務驗證；離線測試本身不作為推論成功證據。

## 保留的準備失敗

最初 inspect gate 把 source directory 誤當 JSON 檔名，拒絕了啟動；改成核對原生載入的 command targets。接著發現固定版 SessionStart 缺少 modelId，改用原生 session model log。這些無 prompt 失敗與後續成功均保留在 evidence；每次追蹤程序與憑證副本清理通過，沒有借此發出付費 prompt。

AC-03 已通過，PR #897 依 CI／正常合併交付，最新狀態見[任務板](tasks/BOARD.md)。完整權限、取消與恢復仍待後續驗收，不宣稱四工位 MVP 完成。

## 首次模型任務

T-0010 的一次已授權 Grok 任務已執行，12.55 秒後因 lab 只識別 file_path、未識別原生 read_file 的 target_file 而停止；兩次讀取請求被拒，seed output 未變，AC-03 未通過。原生 session／模型／prompt 正確，程序與憑證副本清理完整。[失敗與離線修正](evidence/grok-live-2026-11-01.json)：已支援無歧義路徑別名、兩檔並行讀取、按 tool ID 核對完成，保留四次工具 gate／唯一編輯；80 tests 通過。沒有追加付費重跑；PR #897 保持 draft，等新的單次批准。

原生請求使用 target_file；先前測試只覆蓋 file_path，這是 lab 的相容性缺口。已補實際參數案例、並行讀取反序完成、歧義路徑、重複 ID 與未完成就編輯的拒絕測試。沒有把離線修正當成 AC-03 成功；原受測來源 hash 與失敗完整保留。

## 第二次獨立批准的成功驗收

本次明確批准八工具 gate、十二原生 turns、480 秒，但實際只用了三次工具與 18.00 秒。兩個 read_file 使用 target_file，search_replace 使用 file_path，並行讀取的完成順序按 tool ID 核對；只有全部成功後才接受 end_turn Stop。清理產生的另一個 Stop 已另行分類。

預設限制保持原四／六／240；翻倍只允許兩檔範圍內額外讀取，仍只准一次編輯。成功及首次失敗的受測來源 hash 均保留，沒有自動重試或額外模型任務。
