# Codex + Strata：本地工作驗證

> 公開匯入版：先依 [SETUP](SETUP.md) 設定環境（research 文件請見 ../docs/SETUP.md）。原 runs 的連結改指向歷史摘要，原始日誌及截圖不公開。

## 合成程式修復（後續已通過）

執行 `"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --task queue-repair`，讓模型閱讀規格、修復 `task_queue.py` 並執行 unittest。這是 Office 單 worker 排程規則的獨立合成案例，不是上游 Office 的程式修改。

[成功 run（歷史摘要）](evidence/README.md)：`code_task_passed=true`、`fixture_integrity=true`、`code_changed=true`、acceptance exit 0；629 output tokens、61.17 秒、清理無錯誤。模型實際執行 shell 改檔與 5 個公開測試，事件見 [codex.jsonl（歷史摘要）](evidence/README.md)。

獨立驗收程式在模型執行前確認原始 bug 會失敗，完成後檢查全部 active states、terminal/未知狀態、空佇列、穩定 tie-break、不修改輸入及 100 組隨機案例。[baseline（歷史摘要）](evidence/README.md) 失敗，[acceptance（歷史摘要）](evidence/README.md) 全過。驗收在禁止網路及檔案寫入的 `sandbox-exec` 中執行產出程式，不在具有 runner 主機權限的 Python 中 import 它。原始測試與 README 也做位元組比對。

保留的失敗與修正：

- [首次程式修復（歷史摘要）](evidence/README.md)：模型將未被宣告的 `apply_patch` 呼叫寫成文字，未真正修改檔案；Codex exit 0 仍被驗收判為 failed。
- 修復 prompt 要求使用已驗證的 shell 工具寫檔，並明確要求執行工具與測試。這項提示是成功條件的一部分，不能宣稱原始設定已可靠支援 apply_patch。
- [一次快速重跑（歷史摘要）](evidence/README.md) 在 bind preflight 遇到 Address already in use，當時沒有 listener；preflight 增加 SO_REUSEADDR 處理前次連線 TIME_WAIT。現存 listener 仍會使 bind 失敗。

## 基本檔案結果（2026-10-31）

**基本本地檔案工具迴圈已通過。** [成功 run（歷史摘要）](evidence/README.md) 同時有 `status=completed`、`model_inference_verified=true`、`file_task_passed=true`；Codex exit 0、`cleanup_errors=[]`，總耗時 43.03 秒。結束後 `lsof` 未查到 8080 listener。

[Codex 事件（歷史摘要）](evidence/README.md) 顯示模型先執行 `cat input.json`，再執行 Python 讀檔、加總並寫出 `result.json`。隨機 marker 正確，7 + 11 + 24 = 42。完成 turn usage：input 20,868、cached input 13,861、output 203 tokens。[Strata log（歷史摘要）](evidence/README.md) 確認 Responses 請求及初始 prompt 6,800 tokens；[engine log（歷史摘要）](evidence/README.md) 有本機生成紀錄。資源監控期間 pressure level 維持 1，swap 增量為 0。

此次先保留兩次失敗，再針對性修正：

1. [沙箱內執行（歷史摘要）](evidence/README.md)：仍無法取得 Metal；隨後使用者批准對具體 runner 命令提升權限。
2. [首次放行後執行（歷史摘要）](evidence/README.md)：Strata 32K 正常啟動，但 Codex 初始 prompt 達 109,823 tokens，超過 context。該 run 的 [Codex 事件（歷史摘要）](evidence/README.md) 保存實際原因；舊 runner 最終 error 被缺少 result.json 掩蓋。
3. runner 為子程序建立新的 Codex home、不複製原本 auth/config/plugins，清除繼承的 `CODEX_*` 環境，停用非本次任務所需的 apps/plugins/多 agent/瀏覽器等功能與 host skill discovery。這組修改把初始 prompt 降至 6,800 tokens；尚未逐項隔離膨脹來源。runner 現在另保存自身快照、原始 Codex errors 及明確的缺少產物錯誤。

成功 run 仍有兩個非致命提示：`skip_host_skill_discovery` 是開發中功能，以及模型名稱缺少 Codex catalog metadata、採用預設 metadata。後者不是改用雲端模型。沒有增加 context 上限、取消模型工具沙箱或啟用雲端 fallback。

此 run 的範圍僅為合成檔案任務；後續程式修復結果見上節。公開 repo 修改與 Office 三個 provider 尚未驗收。OS 級 egress isolation 尚未審計，`strict_network_isolation_verified=false`。

## 先前失敗（保留歷史）

使用者已授權 subagent 與 Codex 子程序測試。subagent 完成只讀接法查證；主程序確實啟動 `/opt/homebrew/bin/codex` 0.166.0，模型 provider 僅配置 `http://127.0.0.1:8080/v1`，無雲端 fallback，沒有提升或繞過權限。

| 檢查 | 結果 |
|---|---|
| 子程序啟動 | PID 9199，exit 1，已退出 |
| Codex 初始化 | `failed to initialize in-process app-server client: Operation not permitted` |
| localhost bind | `Operation not permitted` |
| Metal device query | `MTLCreateSystemDefaultDevice` 回傳空值 |
| 資源 sysctl | `Operation not permitted` |
| 本地模型推論／讀寫任務 | 未成功，不能宣稱已驗證 |

證據：[子程序與環境結果（歷史摘要）](evidence/README.md)、[stderr（歷史摘要）](evidence/README.md)、[完整 argv（歷史摘要）](evidence/README.md)。後續完整 runner 在 Metal preflight 就停止，沒有載入大模型：[runner 結果（歷史摘要）](evidence/README.md)。

這表示目前父程序的執行限制會留在子程序中；不是啟動另一個 Codex 就能取得 GPU、socket 或批准能力。也不能據此斷言主機沒有 Metal：先前本機 Strata benchmark 已成功，這次測的是目前執行環境的可見性。

## 可以成立的接法

```text
Codex CLI（工具與任務迴圈）
  ├─ /v1/responses → Strata → 本機 Qwen3.8 Q2_0 / Metal
  └─ 本機檔案、shell tools → 本機 workspace
```

Strata 本機原始碼已提供 Codex custom provider 產生器：`../../strata-mac/source/strata_cli/launch/harness.py`。協定是 Responses API，不是只支援 Chat Completions。上游標示曾測 Codex 0.163.0，本機 0.166.0 的後續驗證見本頁歷史結果。

必須使用獨立 **32K context** 設定；上游紀錄 Codex 初始 instructions/tools 約 8.6K–9.4K tokens，原先 4K smoke 設定不適合直接接 Codex。已有 32K 本機硬體測試成功，agent tool loop 的後續結果見本頁上方。

設定範例在 [codex-strata-local.toml](../configs/codex-strata-local.toml)：模型端點只指向 loopback、使用 Responses、關閉 hosted web search、analytics、feedback 與更新檢查。官方配置欄位參考 [OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

## 一條命令跑真正的本地工作測試

在 macOS 正常 Terminal，或允許所需操作的 Codex 會話執行：

```sh
cd "$LAB_DIR"
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py
```

腳本會：

1. 建立新的 run directory 與合成 `input.json`，包含隨機 marker 和數字；不讀私人專案。
2. 檢查 Metal、sysctl、8080 可用；失敗立即保存原因並退出。
3. 啟動既有資源 guard 與暫時防閒置睡眠，使用獨立 32K config 啟動 Strata `--offline`。
4. 啟動真正的 `codex exec`，custom provider 指向 Strata；使用 run 內獨立 Codex home、停用不需要的擴充功能，保留 workspace-write 工具沙箱，子程序不批准提升權限。
5. 要求模型用本機工具讀取 input.json、計算加總、寫 result.json；prompt 不提供 marker 或預期總和。
6. 核對正確 marker、總和、成功 turn 的非零 output token usage 與退出碼，最後清理它啟動的 server、engine、guard、caffeinate。

成功必須在 `runs/local-work-*/result.json` 同時看到 `status=completed`、`model_inference_verified=true`、`file_task_passed=true`。成功前不能把腳本存在當作能力驗證。

只產生設定／fixture 而不啟動服務：

```sh
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --prepare-only
```

若從新 Codex 會話呼叫仍被 sandbox 擋住，應由那個會話對這條 runner 命令提出批准（必須是允許 on-request 的環境）。批准的是本地程序執行；模型設定仍指向本機。本次已取得具體命令批准並完成測試；不要因此假定其他環境也已取得批准。

## 本地優先與隱私邊界

- **本次聊天與 subagent 是本會話的模型服務，不是 Strata。** 將結果貼回這個聊天會把那些結果交給本會話處理。私人資料測試應留在配置成 Strata provider 的獨立 CLI。
- 使用者先前的 Codex 啟動命令只改 sandbox／網路，沒有選本地 model provider，因此不能單憑那條命令認定推論已本地化。
- 本 runner 設定模型請求只走 localhost，模型不可用就失敗，不切換 OpenAI、DeepSeek 或 Grok；沒有複製雲端 provider 金鑰。
- Codex 工具命令的網路保持關閉；Strata `--offline` 停用其已知的下載／遠端圖片／MCP 等路徑。這些配置**不是整棵程序樹的 OS 級對外封鎖證明**，尚未做 egress audit，因此 report 保持 `strict_network_isolation_verified=false`。
- `workspace-write` 主要限制寫入，並不保證只能讀取 fixture 目錄。此測試使用合成資料；不要把 prompt 裡的目錄限制當作私密檔案的 OS 隔離。
- 嚴格隱私驗收應在 OS 級禁止對外連線、允許 loopback 的環境，用合成資料先驗證；仍需核對插件、全域指令、日誌與憑證檔的行為。
- GitHub 即時搜尋會送出查詢和 repo 名稱；可另外啟用明確的公開調研模式，避免送私人程式碼或上下文。完全離線時，改用預先下載的公開 repo 資料。
- Grok CLI、Pi + DeepSeek 是遠端模式。Office 保留這兩種能力，但需明確選擇，不能當私人任務的自動 fallback；Pi 也可另設 Strata provider。

## 後續順序

先通過本地讀寫任務 → 用公開／合成 repo 做修改與測試 → 顯式啟用 GitHub 搜尋 → 驗證產物品質與能力限制 → 才考慮私人專案。這能分別辨識硬體／權限、API 協定、工具迴圈及模型品質的問題。
