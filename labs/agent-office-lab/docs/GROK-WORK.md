# Grok 登入後有界任務

目前完成準備，AC-03 尚未通過。固定官方 Grok Build 1.0.70，模型明確選擇 grok-4.6；已登入無 prompt 啟動、原生 hooks 載入、同 session 模型選擇及清理通過，12.52 秒。35 Node／43 Python tests 通過。[公開證據](evidence/grok-ready-2026-11-01.json)。這些檢查允許 HTTPS metadata，沒有傳模型 prompt。

## 命令與待批准範圍

在 lab 根目錄執行：

```sh
python3 scripts/run_grok_work.py
python3 scripts/run_grok_work.py --check-startup
# 只有取得新的一次配額／付費授權後才執行：
python3 scripts/run_grok_work.py --allow-remote
```

無旗標僅列計畫。單次任務讀取合成 input.json，讀取預建的 result.json，再用 search_replace 將空 JSON object 換成精確 marker／總和。只允許一個新 session、一個 prompt，不接受後續輸入、resume、額外工位、其他帳號或模型。

- 固定 grok-4.6、240 秒期限，host 不自動重試；清理另最多約 22 秒。
- hook gate 最多四次 read_file／search_replace，只有 input.json、result.json，必須先讀兩檔、只能編輯 result 一次，替換內容最多 4096 bytes。檢查 symlink、越界、重複事件、tool ID、截斷 payload 與邏輯工具錯誤。
- 原生參數限制六個 agent turns、只提供這兩種工具，停用 subagents、web、plan；dontAsk 搭配兩檔 Read 與 result Edit 規則，不使用 always-approve 或 bypassPermissions。
- **四工具是 hook gate，不是服務端硬上限。** Grok 的 hook 當機／逾時會 fail-open；handler 能捕捉的異常會明確 deny，但不能保證程序被殺或逾時仍阻擋。原生工具／路徑權限及 OS 寫入限制提供額外邊界。
- Request／token／金額硬上限均為 null。六個 turns 不等於六次 HTTP 請求；服務端重試、配額消耗及計費可能存在，停止本機不能保證立即停止遠端計費。

## 原生驗收契約

Wrapper 精確驗證 Office argv、UUID、隔離 HOME／GROK_HOME／GROK_AUTH_PATH，先用網路全拒絕的原生 `inspect --json` 確認 lab hooks 與 Office hooks 實際載入，且沒有外加 plugins／MCP。上游 --trust 只作用於新建合成 workspace。正式啟動允許 loopback、Unix socket 與 HTTPS；沒有完整讀取／egress 審計。

只複製已登入的私有 auth.json，不帶入 owner 設定、hooks、MCP、rules 或 plugins。原 auth 不修改，run 副本在 finally 清理；原始日志只存忽略的 runs。原生 CLI 可能下載內建 metadata／bundled resources，不能把隔離 HOME 說成完全離線或沒有內建內容。

固定 binary 的 SessionStart 不含 modelId，與目前公開原始碼不同。模型證據改讀同 session、同版本的原生 `model changed` 日誌；在 prompt／工具／完成時核對固定模型。非同 session 的 catalog、CLI 選擇字串或預設模型不能代替該證據。

真實成功需同一 session 的 authenticated Office hooks、正常 end_turn Stop、非 stop-hook continuation、全部工具成功、唯一編輯、精確 JSON／SHA-256 及清理。普通 PostToolUse 可能包含邏輯錯誤，因此只接受已知成功結果 shape；未知格式直接驗收失敗。清理引發的 Stop 單獨記錄，不能當作任務完成。用量與費用尚無真實證據，未知值不可填零。

協定參考：[官方 hooks 文件](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)、[原生事件格式](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-hooks/src/event.rs)。這些原始碼只供契約研究；固定 binary 的 inspect／SessionStart／模型日誌已實測，工具回圈與正常 Stop 仍須單次真實驗收，不用離線測試替代。

## 保留的準備失敗

最初 inspect gate 把 source directory 誤當 JSON 檔名，拒絕了啟動；改成核對原生載入的 command targets。接著發現固定版 SessionStart 缺少 modelId，改用原生 session model log。這些無 prompt 失敗與後續成功均保留在 evidence；每次追蹤程序與憑證副本清理通過，沒有借此發出付費 prompt。

PR 在 AC-03 真實任務通過前保持 draft。下一步是 owner 批准上述單次範圍後執行一次，保留任何失敗，不自動重跑。
