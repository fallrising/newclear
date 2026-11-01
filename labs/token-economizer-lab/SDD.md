# TokenEconomizer 有界實驗設計

Owner 直接指示：建立新 lab，實際跑 Microsoft TokenEconomizer，理解節省 token 的手段。

## 目標與邊界

固定 upstream `c53a4a6dcdebaeb9df6fcaa5c7026f0401cd8f23`，真正執行 Python package 與 plugin hooks／CLI；輸入是明示合成的 session logs，不是人的歷史記錄。實驗不安裝全域 plugin、不啟動 agent、不讀憑證、不付費、不更動使用者設定。

- **AC-01**：Given 固定官方來源，When prepare/run，Then SHA 與 package SHA-256 manifest 核對；錯版本／改檔拒跑。
- **AC-02**：Given 四個相同環境失敗後成功的合成 session，When 真 envfacts fold／SessionStart，Then fact 注入；兩個反證 session 後退休；重複 session 不重算。
- **AC-03**：Given 合成工具目錄／使用記錄，When 到達 prompt/session 門檻，Then 真 toolprune 提案；受保護／曾使用工具不刪；只在 sandbox apply/restore，保留原有規則與 restored keep。
- **AC-04**：Given 冷啟動與五次 ended-green turn，When 重複 edit/failure，Then 冷啟動不介入、暖啟動 backstop redirect 一次後只通知；持續有進展的長 turn 不介入。LLM judge 以明示 paused-state fixture 關閉，不冒稱已測模型判斷品質。
- **AC-05**：Given 合成 usage，When 真 trace/pricing 與 CLI status/config，Then 去重與 cache-aware 算術正確，列出 side-call 成本；不宣稱真實省錢／省 token。
- **AC-06**：Given 乾淨環境，When 單一命令與 CI，Then 無套件依賴即可重跑、報告可讀、離線 guard 與負例測試／repo gates 通過；獨立審查無 must-fix。

## 驗證方法

`make prepare` 只下載已固定來源，`make run` 執行真上游功能，`make check` 驗證來源、安全邊界與整體 scenario。執行器只讀固定 package／標準函式庫和新建 sandbox，runtime 擋 network 與 subprocess，檔案寫入限制於 sandbox。這是可信固定程式的實驗護欄，不是惡意原生碼安全沙箱。

`docs/evidence/report.json` 保存精簡結果；各數值為合成 trace 驅動的實測機制輸出或明示算術例，不是 provider benchmark。未授權真實 provider A/B；後續若批准，需固定任務／模型／起始狀態、隔離 baseline/optimized、計入 proposer/judge、比較 success 與 cache-aware billed usage。
