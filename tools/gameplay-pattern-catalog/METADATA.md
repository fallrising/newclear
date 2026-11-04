# Metadata 指引

本 catalog 把來源快照、來源摘要與本地 design pattern 分開管理。它是獨立筆記與導航，不是 Gameplay Atlas 的鏡像、翻譯版、素材授權或原遊戲規格。

## 網站層級：site.json

- `title`、`url`：來源站名稱與 canonical HTTPS 首頁；不得附加追蹤參數。
- `accessed`：本次查閱日期，不是網站發表或更新日期。
- `coverage.basis`：目前為 `source-snapshot`。分母是 `sources/manifest.json` 的條目數，不能用筆記篇數回推，也不能把舊的 `curated-subset` 改名當成全量完成。
- `coverage.snapshot_id`：必須與 manifest 的快照 ID 相同。不同時間的來源變動另開快照，不混進這次分母。
- `coverage.claim`：`complete` 表示每個來源條目都已取得，且每篇筆記都是 `reviewed`。有 pending、draft、blocked 或缺檔時只能是 `partial`。
- `homepage_observation`：首頁當時寫出的機制數與分類數。它是觀察，不是分母。無 JavaScript 的首頁只顯示範例。
- `verification_boundary`：作者對照公開頁面與內嵌條目。不是獨立審查，也不是實玩。
- `reuse_boundary`、`policy_source`：可重用邊界與來源說明頁。引用不代表取得圖片、全文或程式的再授權。

## 來源 manifest：sources/manifest.json

Manifest 是來源盤點的唯一權威。每條至少包含來源 ID、英文原名、觀察到的簡體原名、canonical URL、原站分類、發現方式、查閱時間、取得方式、取得狀態、內容雜湊，以及對應的本地筆記 ID／路徑。

- 取得狀態：`discovered`、`fetched`、`blocked`、`removed`。已發現不等於已完成。
- `fetched` 必須同時具有頁面內嵌條目、`mechanics/<id>.json` 與 `catalog.json` 的同一文字投影雜湊。
- 非 fetched 必須留下錯誤原因，而且不能把對應筆記標成 reviewed。
- 重跑入口是 `python3 sources/inventory.py`。`--check` 不連網。`--fetch` 只印出與已提交快照的差異，不改筆記、不發布。

## Pattern 層級：Markdown frontmatter

每篇 `patterns/<id>.md` 是筆記內容的唯一權威。檔案以 `---` 包圍 JSON。契約版本是整數 2。既有 ID 與檔名維持不變；`allocation-shop-reservation` 的本地分類仍是 `allocation`，原站分類是 `commerce`。

- `category`：本地 pattern 分類。`source_category`：原站 system id。兩者都必填，允許不同。
- `note_status`：`pending` 是缺內容或占位；`draft` 是有實質內文但尚未完成直接來源對照、取得方式仍是搜尋索引摘錄，或本地分析由模型起草而尚未經人工逐篇審閱；`reviewed` 是作者已用本次快照的公開頁面文字與內嵌條目對過來源摘要、文末網址與狀態。reviewed 不是獨立審查。模型起草的分析只能是 draft，`sources/write_notes.py` 不會寫出 reviewed；改成 reviewed 必須由人逐篇對照來源摘要讀過分析。
- `title` 是繁中設計名稱，`title_en` 必須與 manifest 的英文原名一致。
- `sources`：每項必須有 `title`、canonical `url`、`accessed`、`access_method`。`page-text` 表示讀到公開頁面及其內嵌條目，不表示操作了全部互動控制。`search-index-excerpt` 不能標成 reviewed。
- `related`：0–6 個已收錄 ID。不得自連、重複或懸空。相關節必須逐條寫出關聯理由。

Schema 檢查型別；`build.py --check` 另外檢查檔名、日期、來源末節、manifest 對帳、雜湊一致、完整度報表與筆記狀態。兩者都不能代替人工判斷內容是否正確。

## 固定筆記結構

依序保留：來源摘要、問題與情境（本地分析）、核心循環（本地分析）、解法與取捨（本地分析）、可調參數（本地分析）、失敗模式（本地分析）、最小原型與驗收（本地提案）、相關模式、參考來源。

核心循環要寫出玩家行動、系統回饋、下一個決策。來源摘要只做短篇改寫。本地原型必須寫明尚未實玩驗證。最小範圍、驗收與邊界驗收各用一兩句話說要做什麼、以及怎樣算通過或失敗，不另寫來源沒有的數量或逐步數字腳本。驗收與邊界驗收要寫進該機制自己的規則、測試與邊界，不能用同一句套到每篇；同一句最多出現在兩篇，第三篇就算樣板。來源裡寫明的數字可以保留，而且該數字必須能在該篇 `sources/text/<id>.json` 找到。不在來源裡的判斷要標（本地分析）。

最後一節必須是「參考來源」。標題與 URL 必須逐項對應 `sources`。

## 維護流程

- 改變來源時另建快照，不覆寫本次分母。
- 先改筆記或 manifest，再執行 `python3 build.py --write-docs`，讓完整度報表與 pattern 索引從權威資料重生。不要手改 `docs/coverage.md`、`patterns/README.md` 或 `dist`。
- 篇數與 `source_commit` 由 `python3 status.py --write` 從筆記檔產生。`source_commit` 是筆記檔的 git tree SHA，不是分支 commit。不要手改 SUCCESS 的產生狀態區、`review/pr-snippet.md` 或 inventory 裡這個元件的 `source_commit`。
- 自動對照、抽樣與升成 reviewed 的步驟寫在 `review/README.md`。`review/auto_check.py` 不改 `note_status`。沒有命令或金鑰就略過模型。CI 不跑模型，也不跑 promote。
- 執行 `python3 sources/text_cache.py --check`、`python3 status.py --check`、`python3 build.py --check`、`python3 -m unittest discover -s tests -v`、`python3 build.py`。
- 一般離線建置與單元測試不連到原站，也不呼叫模型。

## 參考來源

- [Gameplay Atlas](https://gameplayatlas.loopyhop.com/) — 查閱：2026-11-02；首頁計數只作觀察。
- [Gameplay Atlas：Content & sources](https://gameplayatlas.loopyhop.com/about/) — 查閱：2026-11-02；原站也區分玩法來源、編輯分析與原型提案。
