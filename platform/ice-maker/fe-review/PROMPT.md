# FE Review Prompt — ice-maker

你是負責 **ice-maker** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `platform/ice-maker/`
- **一句話：** Local-first 個人工程知識編譯器：Python FastAPI 的本機 document service 內嵌一個上傳與批次狀態頁，並輸出 HTML 結果。
- **技術棧：** Python、FastAPI；頁面為 `document_service.py` 內的內嵌 HTML（`_PAGE`）與 `render_html` 產生的結果頁
- **UI 入口：** `document-service`（`ice_maker.document_service:main`）的 `/` 上傳頁，以及批次完成後的 HTML 輸出

## 啟動線索（未驗證）

- 安裝含 document service extras 的環境，執行 `document-service --state-root <tmp> --config config/document-ingestion.json --host 127.0.0.1 --port 8765 --pdfinfo $(command -v pdfinfo)`。
- 只上傳自製的測試文件，不使用任何真實或敏感文件。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 上傳頁 → 選擇檔案送出 → 批次狀態輪詢 → 開啟 HTML 結果

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 上傳表單的 label、錯誤訊息（`request_invalid`）、進度狀態。
- 輸出 HTML 的排版可讀性（標題層級、程式碼、表格）。

## 可重用的既有資產

- 元件 `tests/` 中 document service 相關測試。

## 待補的頁面

批次結果頁：送出批次後以 batch id 補齊。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
