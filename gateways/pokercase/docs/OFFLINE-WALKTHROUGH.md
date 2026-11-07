# 先完整跑一遍，再接真實廠商

這個入口使用真正的 thinrouter binary、自動建立的空白資料庫和本機假上游。你不需要 API key、帳號、Docker 或額外 Python 套件，也不會讀取你原本的 gateway 資料或 CLI 登入資訊。需要 POSIX 系統（本輪驗證 Linux）、Python 3.11+ 及專案的 Rust 1.99.0；程序群組清理和整個 HTTP 請求期限使用 POSIX signals。

在 `gateways/pokercase` 目錄建置並執行：

```sh
cargo +1.99.0 build --locked
python3 scripts/offline_walkthrough.py --check \
  --binary "${CARGO_TARGET_DIR:-target}/debug/thinrouter"
```

程式會逐項輸出 `PASS`，最後輸出結果與 `report.json` 的位置。任何受測步驟不符合契約就回傳非零 exit code；HTTP 200 本身不算串流完成。每次建立獨立資料目錄和報告，不覆寫既有報告。

| 順序 | 實際走過的使用流程 |
|---|---|
| 1 | 啟動 gateway，驗證管理與推論授權，自動建立假上游連線、路由與 gateway key |
| 2 | Chat Completions、Anthropic Messages、OpenAI Responses：文字回覆、完整串流、呼叫本機 `add` 工具並回送結果 |
| 3 | 第一個上游回覆 429，依路由順序 fallback 到成功上游 |
| 4 | 錯誤回覆與持久化錯誤分開驗證；取消串流並觀察上游連線結束 |
| 5 | 查閱實際 admin JSON、管理頁 HTML 與 CSV，核對 token、已知費用小計及未知值 |
| 6 | 重啟同一 gateway 資料目錄，驗證設定與歷史保留、key 與路由仍可使用；最後停止自有程序並清理暫存資料 |

要自己查看管理介面，使用同一入口：

```sh
python3 scripts/offline_walkthrough.py --serve \
  --binary "${CARGO_TARGET_DIR:-target}/debug/thinrouter"
```

它先完成相同驗證，再印出本機 admin URL 和 **臨時管理 token 檔案路徑**。在同一台機器讀取該檔，於管理登入頁貼上 token，即可查看 Connections、Routes、API Keys、Usage。token 不會印在報告中；按 Ctrl-C 後示範服務和臨時資料都會移除，報告保留。遠端環境可沿用你既有的本機連線方式開啟該 loopback URL；本指令不建立對外 listener。

預設報告在 `offline-results/journey-*/report.json`；可用 `--output-dir <目錄>` 指定父目錄。報告記錄階段、數量、摘要、正常串流的合成用量與 attempt 結算資料、binary SHA-256 和 checkout commit。checkout commit 不證明 binary 的建置來源，請先用上面的 locked build 建置。不要提交示範輸出。

## 如何讀取結果

通過代表這個限定範圍的 gateway 離線流程可跑通。用量來自上述真實 HTTP 請求，沒有直接塞資料庫。假上游每個完成的 buffered 回覆及正常串流提供 5 個 input、3 個 output token；設定的價格刻意是合成測試值，每筆估價 $2，**不是廠商報價或真實花費**。

Chat、Messages、Responses 三種 client API 的正常串流必須各自只有一筆完整結算：原始 Chat 上游用量來源 `openai_chat_v1`、精確 5／3 token 與 $2、`succeeded`／`complete`、非空 request／attempt ID 與 finalized_at，以及有序的 headers／first-output／total-observed 毫秒時間。檢查不採信轉換器補出的零值；API 與 CSV 的用量、終態、識別與時間欄位必須一致，HTML 的已知費用小計及 coverage 也必須相符。重啟後再次核對同一歷史。

報告的 `usage.normal_streams` 保留上述觀測值，正常串流缺失用量會直接失敗。失敗與取消仍可能沒有 token 或費用，buffered 的舊終態欄位仍可能 unknown；`unknown_token_rows` 與費用 coverage 保留這些差異，不能把空值當 0，也不能把 HTTP status 當成生成成功。剩餘項目已記錄：

- [串流結算、終止結果與耗時定義 #698](https://github.com/fallrising/newclear/issues/698)
- [其餘用量完整度、來源與價格依據 #699](https://github.com/fallrising/newclear/issues/699)
- [具名 client/version 與真實 AC-01/04/08 #700](https://github.com/fallrising/newclear/issues/700)
- [既有測試啟動不穩定 #701](https://github.com/fallrising/newclear/issues/701)
- [Antigravity 假上游隔離 #702](https://github.com/fallrising/newclear/issues/702)

這個演練不啟動真實廠商 CLI 或模型，也不驗收 IDE 登入、帳號權限或廠商最新協定。它使用 generic API-key OpenAI-compatible **Chat HTTP 假上游**，三種 client API 都走實際 gateway；Messages 與 Responses 由 Chat 轉換。CLI、OAuth／借用憑證、原生 Messages／Responses 上游的串流結算仍在此範圍之外，不能將本次通過擴為完整 #698 或全產品驗收。下一個真實接入階段需先確定 client/version 矩陣；主線仍為 incomplete、沒有 usable tag。

## 隔離與故障定位

子程序使用空白 HOME 和自有 data directory，不繼承 CLI/provider 設定。HTTP proxy 只在本機產生精確允許目的地的 fixture 回覆，其餘目的地與 CONNECT 全部拒絕，從不轉送或解析外部主機。這是演練的 HTTP 配置，並非作業系統層的網路沙箱。

失敗報告提供 `stage` 和固定 `error_code`，不包含 response body、key、session ID 或工具內容。`gateway_exited_before_ready` 表示 gateway 在已認證的 readiness 成功前退出；不直接推定是 port collision。受限環境若禁止 loopback socket 或 compiler cache，應由執行平台處理允許的審批，不修改系統權限。原始回歸指令：

```sh
python3 -m unittest discover -s scripts/tests -p 'test_offline_*.py' -v
cargo +1.99.0 test --locked
```
