# FE Review — ice-maker — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**（待擁有者在設計 PR 確認）。每次修改都走 PR。

## 目標

ice-maker 的 UI 只有兩個伺服器產生的頁面：`document-service` 的上傳與批次狀態頁（`_PAGE`，`src/ice_maker/document_service.py:1241-1253`）與唯讀結果頁（`render_html`，`src/ice_maker/readable_results.py:225-248`）。規格把它定位成「本機批次上傳／狀態介面」，不是完整的 web app（`specs/active/production-document-batch/spec.md:79-81`）。第 2 輪結束時要達到：

- 兩個頁面能在 PROTOCOL 第 0 節的隔離環境內，以合成文件與合成 extractor 啟動，不需要 poppler、tesseract、Docker 或真實文件；只綁 `127.0.0.1`。
- 主要流程（上傳 → 輪詢 → 開啟結果）的每個失敗分支都有看得到的訊息，不會無限輪詢或靜默停止。
- 三種 viewport 沒有水平溢出；axe 沒有 critical／serious；`targets.json` 改為 `verified: true`。

頁面維持內嵌、維持現有的結構與文案語意；只修可用性、狀態呈現與版面。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **A1（REVIEW.md D1，採建議）：第 2 輪維持內嵌頁面**，在 `document_service.py` 的 `_PAGE` 與 `readable_results.py` 的 `render_html` 原地修改；是否抽成 package data 在第 3 輪報告後再決定。
  - **A2（本設計新增）：隔離啟動用 `fe-review/` 內的啟動腳本**，以 `create_app(..., runner=...)` 注入和 `tests/test_document_service.py:84-91` 的 `indexed_runner` 相同的合成 extractor（`ice_maker.extraction.extract_bytes`，只接受 `%ICE-MAKER-SYNTHETIC-PDF` 與 `P1` 點陣圖）。它不是正式啟動路徑，也不修改 `src/`。
- 相關規範：
  - 元件 `AGENTS.md`「Ice Maker product rules」：不寫入秘密、主機路徑或真實資料；外部輸入一律驗證；不修改 `.github/workflows/**`、`orchestration/policies/**`、`CODEOWNERS`。
  - `specs/active/production-document-batch/spec.md` FR-12（第 155-162 行）與非目標（第 79-81 行）：只提供最小的上傳頁、`/healthz`、`POST /api/batches`、`GET /api/batches/{batch_id}`；不做多使用者或精緻化的 web app。
  - `docs/runbooks/production-document-ingestion.md:84-86`：服務沒有認證，只能在 loopback 使用；第 176-183 行：結果頁是「以固定頁面預覽跳脫後的 Markdown」，不是渲染後的 HTML。
  - `validate_bind` 只接受 `127.0.0.1`／`::1`（`document_service.py:1235-1238`），已經符合 PROTOCOL 第 0 節，沒有耦合要解。
  - `tests/test_document_service.py:455-458` 禁止 `document_service.py` 出現 `subprocess`、`requests`、`urllib`、`github`、`git `、`socket` 等字串（不分大小寫）；修改 `_PAGE` 時不能用到這些字（例如 `WebSocket`）。
  - `tests/test_document_service.py:541-548` 斷言上傳頁含 `method="post"`、`name="files"`、`rights`；`:600-634` 斷言結果頁把 `<img src=x onerror=alert>` 跳脫。這些斷言保留、不放寬。

## 不做的事

- 不抽出內嵌頁面（A1），不引入前端框架、建置工具、CSS 框架或新的 Python／JS 依賴。
- 不修改 API、狀態碼、錯誤代碼、SQLite 狀態、批次流程或 `readable_documents` 的回傳內容。列表刻意只含雜湊與非內容的中繼資料（`document_service.py:1083-1088`），不為了顯示檔名而改後端。
- 不把結果頁改成渲染 Markdown（標題、表格、程式碼區塊）：runbook 明定是跳脫後的預覽，而且渲染會擴大 XSS 面。
- 不改 `readable_page` 失敗時回傳 JSON 的行為（`document_service.py:1339-1350`），也不加 CSP 等回應標頭；這些屬後端變更，依 PROTOCOL 第 4 節只能提議。
- 不改 UI 文案語言（目前是英文），不做 i18n；不加深色主題的自訂配色，只讓瀏覽器預設樣式跟隨系統（見 M2）。
- 不修改 `main()` 的必要參數、`scripts/run-document-service.sh`、Dockerfile、loopback relay、CI。
- 不跑正式的 Docker 路徑，不用真實文件、真實 OCR 或真實 poppler。

## 修改項目

### M1 隔離環境的合成啟動腳本，並驗證 `targets.json`

- 對應：REVIEW.md C1；A2；PROTOCOL 第 1 節第 2 輪完成條件。
- 現況：`targets.json` 的 `start` 只帶 `--pdfinfo`，但 `main()` 還要求 `--pdftotext`、`--pdftoppm`、`--tesseract`、`--poppler-version`、`--tesseract-version`、`--installed-language`（`document_service.py:1362-1368`），照抄會直接以參數錯誤結束。即使補齊參數，實際處理需要 poppler 與 tesseract（`ProductionToolchain` 只在啟動時檢查路徑格式，執行時才真正呼叫，`src/ice_maker/document_batch.py:273-295`），結果頁因此需要真實工具鏈才看得到。另一方面，`create_app` 已經可以注入 `runner`（`document_service.py:1256-1274`），測試用它跑完整流程。
- 修改：只新增／修改 `platform/ice-maker/fe-review/` 內的檔案。
  1. 新增 `fe-review/serve_fixture.py`：以 `create_app(state_root="fe-review/runs/.state/service", host="127.0.0.1", config_path="config/document-ingestion.json", runner=<合成 runner>)` 建立 app，合成 runner 等同 `indexed_runner`（`run_batch` + `extract_bytes`，`extractor_binding_sha256` 用固定的假值），再以 `uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)` 啟動。host 寫死 `127.0.0.1`，不接受參數。
  2. 腳本啟動時先送出一個固定的合成批次（兩個 `%ICE-MAKER-SYNTHETIC-PDF`：一個短句、一個超過 300 字元的單行長句，用來測換行；另外依需要加一個會失敗的批次，用來擷取 `failed` 狀態），等處理完成後把 `batch_id` 與 `source_sha256` 印到 stdout。批次 ID 由內容推導（`document_service.py:841`），在第 2 輪確認重複啟動時是否穩定。
  3. `targets.json`：`install` 改為 `pip install -e '.[document-ingestion]'`（`pyproject.toml:11`），`start` 改為 `python3 fe-review/serve_fixture.py`，`env` 加 `PYTHONPATH=src`；`pages` 加上結果頁 `/batches/<batch_id>/documents/<source_sha256>`（兩份文件各一頁）。批次 ID 不穩定時，改由腳本把路徑寫進 `runs/.state/`，並在 `PROMPT.md` 說明如何補頁面。
  4. 在隔離環境跑 `node docs/fe-review/capture.mjs platform/ice-maker/fe-review/targets.json --dry-run` 與 `--start`；全部通過後把 `verified` 改為 `true`，`verifiedNote` 寫日期與 commit。
- 驗證：`--dry-run` 的頁面數等於 `targets.json` 的頁面數；`capture.json` 每筆 `status` 為 200、`pageErrors` 為空；`curl -s http://127.0.0.1:8765/healthz` 回 `{"status":"ok"}`；`make check` 通過（確認新檔案沒有被 `scripts/check_repo.py` 拒絕）。
- 風險與回滾：只動 `fe-review/`，回滾即 revert。風險是 `check_repo.py` 或測試若掃描整個元件目錄，可能對新 `.py` 檔有要求，依結果調整；若擁有者不接受 A2，改為在 `PROMPT.md` 寫出等價的 `python3 -c` 片段，不新增檔案。

### M2 上傳頁的文件外殼與最小版面

- 對應：REVIEW.md C2、C3；A1。
- 現況：`_PAGE`（`document_service.py:1241-1242`）沒有 `<html lang>`、沒有 viewport meta、沒有 `color-scheme`，也沒有任何樣式；四個 `<label>` 與按鈕全部排在同一行內（inline），390px 下擠成一團，`<h1>` 以外沒有結構。
- 修改：只改 `_PAGE` 字串的外殼與樣式，不改表單欄位、名稱、`id`、選項值或 `action`。
  - 加 `<html lang="en">`、`<meta name="viewport" content="width=device-width, initial-scale=1">`、`<meta name="color-scheme" content="light dark">`。
  - 加一段內嵌 `<style>`（目標 30 行以內）：內容最大寬度、每個欄位一行（label 在上）、欄位與按鈕的間距、`:focus-visible` 外框、`#results` 內的長雜湊可換行（`overflow-wrap: anywhere`）。顏色只用 `system-ui`／`Canvas`／`CanvasText` 等系統值，讓深色由 `color-scheme` 處理。
  - 表單外包一個 `<main>`。
- 驗證：`make check`；在 `tests/test_document_service.py` 的 `test_health_browser_page_multipart_202_and_status` 增加 `lang="en"` 與 `name="viewport"` 的斷言（只新增，不改既有斷言）；第 3 輪以三種 viewport、light／dark 擷取。
- 風險與回滾：頁面文字與行為不變；若新字串碰到 `:455-458` 的禁用字，測試會失敗，改字即可。回滾即 revert 該 commit。

### M3 上傳頁的狀態與錯誤處理

- 對應：REVIEW.md C3。
- 現況（全部在 `document_service.py:1252` 的單行 script）：
  1. 上傳失敗只顯示 `Upload failed`，丟掉伺服器回的 `detail`（例如 `request_invalid`，`:1279-1281`；各種 `ServiceError`，`:1295-1298`）。
  2. 輪詢 `GET /api/batches/{id}` 沒有檢查 `response.ok`：404／409 回的 JSON 沒有 `status`，落到 `else` 分支，每 500ms 重試，永遠不停。`fetch` 本身丟例外（服務停止）時 promise 被拒絕，畫面停在 `Processing …` 不再更新。
  3. 送出中沒有停用按鈕，可以重複送出（重送相同內容是冪等的，但使用者看不出來）。
  4. `OCR languages` 以 `,` 切開後沒有去除空白，`chi_tra, eng` 會送出 `" eng"`，被伺服器以 400 拒絕，但畫面只說 `Upload failed`。
  5. 輪詢期間只顯示 `Processing <batch id>`，看不到 `queued`／`running` 與 `counts`（`status` 已回傳，`:891`）。
- 修改：只改 `_PAGE` 內的 script，行為範圍如下：
  - 上傳失敗顯示 `Upload failed: <detail>`；`detail` 以 `textContent` 寫入，不用 `innerHTML`。
  - 輪詢遇到非 2xx 或例外時停止輪詢，顯示 `Status unavailable: <detail 或 HTTP 狀態>`。輪詢加上上限（例如 30 分鐘，或依 `config` 的 `timeout_seconds` × 檔案數推算，第 2 輪決定具體值並寫回本檔），逾時顯示訊息而不是無限重試。
  - 送出後停用按鈕，並設 `aria-busy="true"`；完成、失敗或停止輪詢時恢復。
  - `languages` 每一項 `trim()` 後再過濾空字串與排序。
  - 輪詢期間顯示 `Batch <id>: <status>` 與 `counts` 的數字（純文字）。
  - 完成後的列表每份文件除了預覽連結，再加一個 `Download Markdown` 連結指向既有的 `/api/batches/{id}/documents/{sha}/markdown`。
  - 把 script 從單行改成多行，方便之後維護與 review；不引入外部檔案。
- 驗證：`make check`；在 `DocumentServiceHttpTests` 增加斷言：頁面 script 含 `response.ok` 的輪詢檢查與 `trim()`（字串層級的回歸測試，元件沒有 JS 測試工具，不新增依賴）；第 3 輪用 Playwright 腳本（放在 `fe-review/`）擷取：正常完成、上傳 400（在 Playwright 腳本內攔截 `POST /api/batches` 並改寫成不合法的 `metadata`）、`failed` 批次三種狀態。
- 風險與回滾：只改前端行為，API 不變。輪詢上限設太短會讓大批次誤報逾時，所以預設保守並在訊息中說明可以重新整理後查詢。回滾即 revert。

### M4 結果頁的換行與導覽

- 對應：REVIEW.md C4。
- 現況：`render_html`（`readable_results.py:238-244`）只輸出 `<pre>` 與下載連結，沒有 `lang`、viewport、標題或返回連結。`render_markdown` 把一頁 PDF 文字接成單一行（`readable_results.py:189-195`），所以 `<pre>` 在任何 viewport 都會水平溢出。
- 修改：只改 `render_html` 產生的固定外殼：
  - 加 `<html lang="en">`、viewport、`color-scheme` meta。
  - `<pre>` 加 `white-space: pre-wrap; overflow-wrap: anywhere`（用 `<style>` 或 `style` 屬性），保留等寬字型。
  - 加 `<h1>Readable document</h1>` 與回到 `/` 的連結；Markdown 本文仍然只經過 `html.escape` 後放進 `<pre>`，不做任何渲染。
- 驗證：`make check`；既有 `:600-634` 的跳脫斷言保留；在同一個測試增加 `pre-wrap` 與 `lang="en"` 的斷言；確認 `MAX_HTML_BYTES` 的上限檢查（`readable_results.py:245-247`）仍在最後執行。第 3 輪以長行合成文件在 390px 擷取，`capture.json` 的水平溢出為 false。
- 風險與回滾：外殼增加約 300 bytes，對 256 KiB 上限的影響可忽略，但接近上限的文件可能從 200 變成 413；在 PR 說明記錄新增的位元組數。回滾即 revert。

## 啟動方式（第 2 輪要驗證的版本）

- 環境：PROTOCOL 第 0 節的容器（獨立 network namespace，不用 `--network host`）；Python ≥ 3.11（`pyproject.toml:8`）。不需要 poppler、tesseract、Docker。
- 安裝：`cd platform/ice-maker && pip install -e '.[document-ingestion]'`。
- 啟動：`cd platform/ice-maker && PYTHONPATH=src python3 fe-review/serve_fixture.py`（M1），綁 `127.0.0.1:8765`；狀態目錄 `fe-review/runs/.state/service`（git-ignored），每次執行前可以刪除。
- 合成資料：腳本內產生的 `%ICE-MAKER-SYNTHETIC-PDF` 文件（只含 ASCII 假文字）；metadata 用 `rights=confirmed`、`data_class=internal`、`languages=["chi_tra","eng"]`。沒有帳號、token 或憑證。
- 正式路徑（`scripts/run-document-service.sh`：無網路容器 + Unix socket + loopback relay）不在 fe-review 範圍內，沿用 runbook 的驗證。

## 第 3 輪驗收

- 頁面與流程：`targets.json` 的上傳頁與結果頁；`PROMPT.md` 的主要流程，另外擷取上傳失敗、`failed` 批次、輪詢期間三種狀態。
- 通過條件：
  - 無 blocker／major。
  - axe 無 critical／serious。
  - 三種 viewport、light／dark 都沒有水平溢出；結果頁的長行會換行。
  - console 沒有 error；沒有非預期的 4xx／5xx（刻意觸發的上傳 400 需在報告註明）。
  - 失敗分支都有可見訊息，輪詢在失敗或完成後停止（在擷取腳本中檢查一段時間內沒有再發出 `GET /api/batches/{id}`）。
- 已知不在驗收範圍：真實 PDF／OCR 的擷取結果與中文字型呈現（合成 extractor 只處理 ASCII）；正式 Docker 與 relay 路徑；production bundle 大小（沒有前端建置）。

## 開放問題

- A1 之後：第 3 輪報告的發現數量是否足以支持把頁面抽成 package data（REVIEW.md D1）。
- 列表只顯示來源雜湊，使用者難以對應到檔名。可行選項：(a) 前端用 `crypto.subtle.digest` 對已選檔案計算 SHA-256 再對應（純前端，但要把檔案讀進記憶體，單檔上限 256 MiB）；(b) 後端在列表回傳檔名（API 變更）。本設計不處理，待擁有者決定是否列入 REVIEW.md。
- 結果頁的失敗回應是 JSON（`document_service.py:1339-1350`），在瀏覽器直接開啟時不友善；是否改成 HTML 屬後端決定，本設計不處理。
