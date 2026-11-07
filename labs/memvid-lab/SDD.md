# Memvid 場景實跑設計

## 目標與來源

Owner 於 2026-10-28 直接要求：讀取 `memvid/memvid`，在 `newclear` 建立使用它的專案，把官方提供場景的功能跑一次。

上游閱讀基準為 [memvid/memvid e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813)。套件 wheel 與 Rust repository 版本分開記錄，不假設它們同版。
本 repo 基準為 `f16dc2bb825ab1c85e5a68416aa46e80c58902b4`。新元件位於 `labs/`，不整合到其他產品的 runtime。

## 可觀察成果

提供一個命令列實驗專案：準備依賴／模型後，執行每個場景，產生 `.mv2`、查詢證據和 JSON 報告。每個案例包含合成輸入、真實 SDK 操作、可核對 oracle 和錯誤狀態。使用者可在輸出記憶檔上繼續查詢。

README 的 11 類 use case 是不同應用情境。本實驗驗證它們的記憶層，不建立 11 個完整企業產品。場景必須涵蓋：

| ID | 官方場景 | 實跑行為 |
| --- | --- | --- |
| UC-01 | Long-Running AI Agents | 寫入階段記憶，關閉後以新程序讀回並繼續追加 |
| UC-02 | Enterprise Knowledge Bases | 多份規章／知識文件的帶來源檢索 |
| UC-03 | Offline-First AI Systems | 已準備依賴後，在禁止外部網路的程序內建立及檢索記憶 |
| UC-04 | Codebase Understanding | 合成程式碼與設計文件的符號／行為檢索 |
| UC-05 | Customer Support Agents | 從政策與工單找出回答依據，保留引用 |
| UC-06 | Workflow Automation | 儲存事件、工作步驟與執行結果，再檢索可用步驟 |
| UC-07 | Sales and Marketing Copilots | 從合成客戶需求與產品文件檢索相符證據 |
| UC-08 | Personal Knowledge Assistants | 個人筆記、繁中內容及時間資料的持久化查詢 |
| UC-09 | Medical, Legal, and Financial Agents | 三類合成政策／說明文件檢索；不產生專業建議 |
| UC-10 | Auditable and Debuggable AI Workflows | 核對 frame 來源、時間線、更新前後內容與可用的 session 紀錄 |
| UC-11 | Custom Applications | 自訂資料欄位、索引與檔案搬移後讀取 |

另驗證官方具名範例涉及的 basic lifecycle、PDF ingestion、實際 CLIP 視覺搜尋與 Whisper 語音轉錄，及本地文字 embedding 的語意檢索。圖片／語音必須經過真實模型，不能用檔名或預置文字作為 oracle 的輸入。

## 架構與操作界線

- Python CLI 負責準備資料、逐場景執行與 evidence；Memvid SDK 負責真正存放與查詢。
- 使用精確版本與依賴鎖檔；模型記錄來源、revision 和 SHA-256。初次下載需要網路與磁碟空間。
- 基礎檢索明確停用隱式 embeddings；語意／多模態步驟顯式指定本地模型。不使用任何付費 API。
- 每次 run 使用新的目錄。先拒絕已存在目的地，再呼叫可能覆寫檔案的 `create`。
- 完成 commit／close 後，以只複製 `.mv2` 到新目錄的方式驗證 portable read。若 session 有 sidecar，先明確結束，再檢查需求。
- 問答場景輸出附來源的檢索 context；本實驗沒有 LLM 生成器。上游效能、accuracy、任意 branch/time-travel 及合規宣稱均不因此得到驗證。
- JSON 報告記錄版本、案例、預期、實得、計時、檔案雜湊和執行狀態；不能將檢查錯誤吞成 pass。

### 實作探勘後的明示適配

原始多筆寫入的 lexical 索引出現來源漏失／映射異常，單純 seal/reopen 未能穩定消除。
本 lab 對自己新建的資料，於寫入階段使用官方 `doctor(rebuild_lex_index=True)` 準備索引，再檢查相同內容 oracle；唯讀 query 不自動修復。
這是已知上游問題的明示適配，不改寫「原始行為失敗」的紀錄。

Python wheel 未內建 Whisper，且其本地 BGE feature 不可用。BGE 採真 ONNX provider → Memvid index；
Whisper 以固定官方 crate 的原生 `WhisperTranscriber` 加本地 cache 初始化補丁執行。
補丁只讓模型從明確準備目錄載入，推論不變；實際 crate hash、VCS dirty 標記與 GitHub 閱讀基準分開記錄。

## 驗收與重現

完整 AC 見 [SUCCESS.md](SUCCESS.md)。先跑 dependency/API probe，將文件與實際 SDK 差異記錄，再執行基本場景與模型場景。模型不可用或功能不在 SDK 時保留具體錯誤、可重試命令和 `blocked`，主線保持 incomplete。
必要負例包括：不存在的 query 不得得到虛構引用、既有輸出路徑拒絕覆寫、模型缺失不可偽裝為 pass、離線限制可觀察。

原交付先以 Draft PR 提交；owner 後續授權後已正常合併 #709，並由 #733 完成任務結案。README、操作入口、上游能力矩陣、精簡證據、必要 CI 與獨立審查均已交付。這是可重現實驗，沒有 production 部署。

後續 owner 已批准的繁中筆記評估另見 [T-0436 規格](docs/notes-usability.md)，不修改本文件原場景與 AC。
