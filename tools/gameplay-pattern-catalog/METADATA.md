# Metadata 指引

本 catalog 將網站資源指引、來源摘要與本地 design pattern 分開管理。它是獨立筆記與導航，不是 Gameplay Atlas 的鏡像、翻譯版、素材授權或原遊戲規格。

## 網站層級：site.json

- `title`、`url`：來源站名稱與 canonical HTTPS 首頁；不得附加追蹤參數。
- `accessed`：本次查閱日期，不是網站發表或更新日期；不知道發表日期就不猜。
- `resource_type`、`catalog_language`、`source_language_read`：資源類型、本地筆記語言、實際讀取的來源語言。
- `coverage`：目前固定為 `curated-subset`。`curated_count` 由筆記數量核對，不能拿原站數量冒充收錄量。
- `reported_counts`、`count_source`：原站自述的機制與分類數量及證據地址；屬帶日期的觀察，並非逐項盤點。
- `selection`、`verification_boundary`：挑選依據、實際讀取方式、沒有驗證的部分。
- `reuse_boundary`、`policy_source`：可重用邊界與來源說明頁；引用不代表取得圖片、全文或程式的再授權。

本次記錄 14 篇，覆蓋 13 個本地分類。來源首頁標示 280 個機制／28 類；本地分類不是原站 taxonomy 的完整複製。13 篇核對公開頁面文字摘錄；價格探索一篇僅核對搜尋索引摘錄，可能落後於即時網站。未執行原遊戲，也未抓取完整 JavaScript 資料集。

## Pattern 層級：Markdown frontmatter

每篇 `patterns/<id>.md` 是唯一權威來源。檔案以 `---` 包圍 JSON 物件，之後是 Markdown；JSON 是 YAML 的子集，但本專案刻意只接受 JSON，避免引入 YAML parser 或隱含型別。

- `schema_version`：契約版本，目前為整數 1。
- `id`：穩定的小寫 kebab-case ID，必須與檔名相同。改名會破壞連結，須同步檢查所有關聯。
- `title`、`title_en`：繁中 pattern 名稱與來源機制英文名稱；本地名稱可以較抽象，但不能偽裝成來源原文標題。
- `category`：本地受控分類；允許值見 [欄位 schema](pattern.schema.json)。`tags` 是 1–8 個機制特徵，不以遊戲類型取代設計問題。
- `summary`：至多 240 字元的獨立摘要，供搜尋、列表與 HTML description 使用。
- `related`：0–6 個已存在的 pattern ID；不得自連、重複或指向未收錄項目。
- `sources`：每項必須有 `title`、canonical `url`、`accessed`、`access_method`；不得只有首頁而沒有實際機制頁。
- `access_method`：`page-text` 代表讀取到公開頁面的文字摘錄，不表示檢視完整互動頁；`search-index-excerpt` 代表只核對搜尋索引摘錄，不應升格為直接頁面或原遊戲驗證。

Schema 檢查欄位型別；`build.py --check` 另檢查檔名、日期、來源末節、關聯目標與數量一致性。兩者不能取代人工對照來源或判斷內容是否正確。

## 固定筆記結構

依序保留：來源摘要、問題與情境、解法與取捨、可調參數、失敗模式、最小原型與驗收、相關模式、參考來源。後六項中涉及設計判斷的部分明示為本地分析／提案，不替原作者宣稱意圖。

來源摘要只做短篇改寫；不整頁翻譯或複製案例、圖片及原站示意數值。本地原型使用自訂的小範圍與可觀察結果，數值不是原遊戲參數，也不是工期預估。

最後一節必須是「參考來源」。該節的標題與 URL 必須逐項對應 `sources`，且查閱方式與日期也應保留。產生的 HTML 使用同一末節，不把引用集中移到全站某個角落。

## 維護流程

- 先打開具體機制頁，記錄取得方式與日期；只有搜尋摘要時照實標示，不補寫沒讀到的內容。
- 新增一篇 JSON frontmatter 加 Markdown 筆記，寫出原創的設計取捨與可驗證原型；只連到已收錄的 related ID。
- 更新 `site.json` 的本地數量與範圍；新增分類時同時修改 `build.py` 與 `pattern.schema.json`。
- 執行 `python3 build.py --check`、`python3 -m unittest discover -s tests -v`、`python3 build.py`；檢查筆記最後的來源與生成頁面，不編輯 `dist` 來修內容。
- 複核來源的變更或失效時保留先前查閱紀錄；未查閱不能更新成今天，也不能以 HTTP 200 代替內容驗證。此專案沒有自動同步或排程爬蟲。

## 人與 Agent 如何使用

從問題、循環或資源限制選 pattern，讀取取捨與失敗模式，再把最小原型改成專案自己的 Given／When／Then。可透過 `dist/catalog.json` 機器可讀索引 取得 metadata 與筆記內容；索引及靜態頁都是從 Markdown 建置，不是第二份可手改資料庫。

建議把「已核對的來源事實」「本地分析」「尚未驗證的提案」當作不同證據等級。引用有助於回溯，但不保證玩法在你的產品中有效。

## 參考來源

- [Gameplay Atlas](https://gameplayatlas.loopyhop.com/) — 查閱：2026-11-02；原站範圍數字來自首頁。
- [Gameplay Atlas：Content & sources](https://gameplayatlas.loopyhop.com/about/) — 查閱：2026-11-02；原站也區分玩法來源、編輯分析與原型提案。
