# FE Review — ice-maker — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認其中的假設。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。

## 矛盾點

### C1 正式啟動需要真實工具鏈，無法直接用於擷取

`main()` 除了 `--pdfinfo`，還要求 `--pdftotext`、`--pdftoppm`、`--tesseract`、`--poppler-version`、`--tesseract-version`、`--installed-language`（`src/ice_maker/document_service.py:1362-1368`），實際處理會呼叫 poppler 與 tesseract。正式路徑是無網路容器 + Unix socket + loopback relay（`scripts/run-document-service.sh`）。安裝 extras 的名稱是 `document-ingestion`（`pyproject.toml:11`）。綁定位址已限制為 loopback（`document_service.py:1235-1238`），不是耦合；`create_app` 可以注入 `runner`，所以 fe-review 可以用合成 extractor 單獨啟動（`DESIGN.md` M1）。

### C2 UI 是內嵌在 Python 字串中的 HTML

上傳頁是 `document_service.py:1241-1253` 的 `_PAGE`，結果頁由 `src/ice_maker/readable_results.py:225-248` 的 `render_html` 產生。兩者無法以前端工具單獨檢查或測試，修改需要改 Python 原始碼，並受 `tests/test_document_service.py:455-458` 的禁用字串檢查約束。

### C3 上傳頁缺少文件外殼與失敗分支

`_PAGE` 沒有 `lang`、viewport、樣式；script（`document_service.py:1252`）上傳失敗時丟掉伺服器的 `detail`，輪詢遇到 404／409 會無限重試，`fetch` 例外時靜默停止，送出中不停用按鈕，`OCR languages` 不去除空白。修改方式見 `DESIGN.md` M2、M3。

### C4 結果頁的長行水平溢出

`render_markdown` 把一頁 PDF 文字接成單行（`readable_results.py:189-195`），`render_html` 放進沒有換行樣式的 `<pre>`（`readable_results.py:238-244`），任何 viewport 都會水平溢出。結果頁刻意是跳脫後的 Markdown 預覽，不是渲染後的 HTML（`docs/runbooks/production-document-ingestion.md:176-183`）。修改方式見 `DESIGN.md` M4。

## 需要放開或決定的點

### D1 內嵌頁面是否抽成獨立檔案

- 選項：(a) 抽成 package data 的 HTML／CSS／JS，由服務讀取；(b) 維持內嵌。
- 建議：建議第 3 輪後再決定：頁面很小，(a) 的收益取決於報告發現的問題數量。
- 狀態：**待擁有者決定**。`DESIGN.md` 以建議作為假設 A1（第 2 輪維持內嵌），在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設（A1、A2）都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- 本次設計 PR（`fe-review/design-ice-maker`，Closes #151）：新增 `DESIGN.md`，改寫 C1，新增 C3、C4，修正 `PROMPT.md` 與 `targets.json`。
