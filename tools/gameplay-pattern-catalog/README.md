# Gameplay Pattern Catalog

以 Gameplay Atlas 為來源的繁體中文設計模式筆記與 metadata 指引。先讀 [SUCCESS](SUCCESS.md) 了解已驗證範圍及缺口；需求與 AC 見 [SDD](SDD.md)。

目前為 14 篇精選筆記、13 個本地分類，不是原站 280 個機制的全量鏡像。每篇將短篇來源摘要與本地分析／原型提案分開，最後保留機制頁網址。來源網站的分類、圖片、全文或遊戲素材未被搬入，也不被本 repo MIT 重新授權。

## 入口

- [Metadata 指引](METADATA.md)：網站層級與 pattern 層級欄位、來源證據與維護流程。
- [全部 pattern 筆記](patterns/README.md)：可直接在 GitHub 閱讀，無需啟動網站。
- [網站 metadata](site.json) 與 [pattern JSON Schema](pattern.schema.json)：機器可讀契約。
- [驗證紀錄](docs/verification.md) 與 [任務板](docs/tasks/BOARD.md)：實測結果、限制與交付狀態。

## 本機使用

Runtime 只需 Python 3.11+，建置不安裝套件、不抓網路、不呼叫模型。

```sh
cd tools/gameplay-pattern-catalog
python3 build.py --check
python3 -m unittest discover -s tests -v
python3 build.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

瀏覽器開啟 `http://127.0.0.1:8080/`。首頁可搜尋繁中、英文、標籤與筆記內文，可按機制分類；每篇有獨立頁與來源末節。無 JavaScript 仍可從完整索引閱讀筆記。所有資源使用相對路徑，可放在靜態主機的子路徑；本次沒有部署。

`dist/catalog.json` 包含網站 metadata、pattern metadata 與 Markdown 內文，供 Agent 或其他工具讀取。`dist` 是可重建產物，不應手改或提交。輸出到已存在的非本工具產生目錄會被拒絕，避免覆寫無關資料。

## 瀏覽器 QA

瀏覽器測試不是 runtime 依賴。具備 Playwright 1.57.0 與 Chromium 時可執行：

```sh
python3 -m pip install playwright==1.57.0
python3 -m playwright install --with-deps chromium
python3 tests/browser_smoke.py
```

預設實際透過本機 HTTP 點擊頁面、測試搜尋與分類、390px 排版及無 JavaScript 導航。CI 使用此模式。受限環境可執行 `python3 tests/browser_smoke.py --render-only` 渲染實際建置內容；此模式明確不驗證瀏覽器 URL 導航，不能當成完整瀏覽器測試通過。

## 維護與邊界

Markdown frontmatter 是唯一權威資料；JSON Schema 和 `build.py --check` 共同約束欄位與跨檔關係。新增筆記流程見 [METADATA](METADATA.md)。沒有帳號、分析追蹤、遠端字型、外部圖片、背景更新或自動爬蟲。

「價格探索」的來源目前僅核對搜尋索引摘錄，其他 13 篇核對公開頁面文字摘錄；不表示已檢視全部互動內容或實玩原遊戲。未發行 usable tag，未合併或部署。
