# T-0001 驗證紀錄

日期：2026-11-02。認領／規格 commit：`fffc1c84ff94f4d8bdf94e9ecf1705c09e759f32`。實作候選以 PR head 與 [內容雜湊](checksums.json) 核對；不把認領 commit 冒充含有實作的版本。

## 本機實跑

環境：Python 3.13.5、Node 22.16.0、Playwright 1.57.0、環境提供的 Chromium。建置 runtime 只用 Python 標準函式庫，瀏覽器 QA 套件不屬 runtime 依賴。

| 檢查 | 結果 | 證據摘要 |
| --- | --- | --- |
| `python3 build.py --check` | passed | 14 篇、13 個分類；欄位、來源末節、關聯與日期一致 |
| `python3 -m unittest discover -s tests -v` | passed | 18 tests；含危險 URL、JSON 重複欄位、來源錯配、HTML escaping、輸出目錄保護、symlink、確定性建置與所有本地 HTML 連結 |
| `python3 build.py` | passed | 14 個詳情頁、首頁、metadata 頁與 JSON 索引；兩次建置逐檔 SHA-256 相同 |
| `node --check app.js` | passed | 原生 JavaScript 語法檢查 |
| JSON Schema 2020-12 額外檢查 | passed | 本機 jsonschema 驗證 14 個 frontmatter；此套件僅用於開發核對，未加入 runtime |
| Python HTTP client | passed | 從本機 `/dist/` 取得 19 個資源，均為 HTTP 200 且非空；這不是瀏覽器導航 |
| `python3 tests/browser_smoke.py --render-only` | passed | 真 Chromium 渲染實際建置 bytes；搜尋、分類交集、空結果、清除、NFKC、詳情與來源內容、390px 無水平溢出、無 JS 內容；無 pageerror 或外部請求 |
| `python3 tests/browser_smoke.py` | blocked | Chromium 導航 localhost 時回報 `net::ERR_BLOCKED_BY_ADMINISTRATOR`；file URL 亦受封鎖。沒有改動或繞過環境政策 |
| 全 repo `check_indexes.py` | pending | 終端無法解析 GitHub，使用 GitHub App 取得必要檔案，非完整 checkout；由 PR CI 執行，不宣稱本機全 repo 通過 |

render-only 測試把建置出的 HTML、CSS、JS 直接載入 Chromium。它驗證真實 UI 邏輯與排版，但不驗證 URL 載入或點擊導航；完整模式由新增的 CI workflow 執行。測試腳本保留兩種模式並輸出不同結果，不以替身掩蓋限制。

## 內容來源

13 篇核對 Gameplay Atlas 公開頁面文字摘錄；commerce-price-discovery 的直連頁面當次只回傳開啟提示，因此改用搜尋索引摘錄，sources.access_method 明列為 search-index-excerpt。查閱日期是本次讀取日期，不推定為來源發表／更新日。所有筆記在最後一節提供具體機制頁 canonical URL。

網站自述的 280／28 只存在來源 metadata 與帶日期的範圍說明；實際收錄為 14／13。沒有全站盤點、原遊戲執行、原站完整互動頁驗證、圖片或全文下載。原創 prototype 的數字不是來源遊戲參數。

## Git 與驗收界線

終端 `git ls-remote` 失敗：`Could not resolve host: github.com`。GitHub App 的 repo read/write 已確認；使用 tree → commit → 非 force、帶 expected_sha 的 update_ref，保留原子提交與回讀。

README、PROJECTS、inventory 的本機基準逐檔 Git blob SHA 與 App 回傳相同，之後只加入本元件條目。新增 CI 會明確執行 `check_project_success.py --write-index`、檢查 PROJECTS 沒有重建差異，再執行 `check_indexes.py` 及完整瀏覽器 smoke。CI 結果以 PR checks 為準，未回讀前不宣稱通過。

未進行 merge、deploy、release 或獨立審查；任務板仍為 in_progress。完整瀏覽器及 repo CI 通過後才補充驗收證據；沒有 usable tag。
