# FE Review Prompt — ice-maker

你是負責 **ice-maker** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；第 2 輪要做的修改與驗收見 [DESIGN.md](DESIGN.md)（草稿），尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `platform/ice-maker/`
- **一句話：** Local-first 個人工程知識編譯器：Python FastAPI 的本機 document service 內嵌一個上傳與批次狀態頁，並以固定頁面預覽跳脫後的 Markdown 結果。
- **技術棧：** Python、FastAPI；上傳頁為 `src/ice_maker/document_service.py` 內的內嵌 HTML（`_PAGE`），結果頁由 `src/ice_maker/readable_results.py` 的 `render_html` 產生。沒有前端建置、沒有 JS 依賴。
- **UI 入口：** `/` 上傳頁；批次完成後的結果頁 `/batches/<batch_id>/documents/<source_sha256>`（`<pre>` 內的跳脫 Markdown 與 **Download Markdown** 連結）。

## 啟動線索（未驗證）

- 安裝：`cd platform/ice-maker && pip install -e '.[document-ingestion]'`（Python ≥ 3.11）。
- 正式的 `document-service` CLI 需要 poppler 與 tesseract 的四個執行檔路徑、兩個版本字串與 `--installed-language`（`document_service.py:1355-1368`），不適合用來擷取。
- 擷取改用 `DESIGN.md` M1 的合成啟動腳本 `fe-review/serve_fixture.py`（第 2 輪新增）：以 `create_app` 注入合成 extractor，只綁 `127.0.0.1:8765`，狀態放 `fe-review/runs/.state/`。腳本新增前，第 1 輪不啟動。
- 只使用 `%ICE-MAKER-SYNTHETIC-PDF` 合成文件，不使用任何真實或敏感文件。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 上傳頁 → 選擇檔案送出 → 批次狀態輪詢 → 開啟結果頁 → Download Markdown 連結存在

另外擷取：上傳被拒（400，顯示伺服器的 `detail`）、批次 `failed`、輪詢期間的狀態文字。

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 上傳表單的 label、錯誤訊息（`request_invalid` 與其他 `detail`）、送出中與輪詢中的狀態；輪詢在完成或失敗後會停止。
- 結果頁是刻意不渲染的跳脫 Markdown（`docs/runbooks/production-document-ingestion.md:176-183`）：檢查長行換行、等寬字型可讀性與 HTML 跳脫，不要求標題層級或表格排版。
- 修改 `_PAGE` 時不可出現 `tests/test_document_service.py:455-458` 的禁用字串（例如 `socket`）。

## 可重用的既有資產

- `tests/test_document_service.py`：`indexed_runner`（第 84-91 行）與 `synthetic_pdf`（第 94-100 行）可跑完整流程；`DocumentServiceHttpTests` 以 ASGI 直接驗證頁面與路由。
- `make check`：元件的 repo 檢查與全部 unittest。

## 待補的頁面

批次結果頁：M1 的啟動腳本會送出固定的合成批次並印出 `batch_id` 與 `source_sha256`，第 2 輪以此補齊 `targets.json`。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
