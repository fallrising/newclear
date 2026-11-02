# T-0001 驗證紀錄

日期：2026-11-02。交付：[Draft PR #960](https://github.com/fallrising/newclear/pull/960)。未 merge、deploy 或 release。

## 已通過的 CI 候選

- 認領／規格：`fffc1c84ff94f4d8bdf94e9ecf1705c09e759f32`。
- 實作：`431ccaace7af39fbffb44ed73c73df0fd4d7b0c7`。
- 補齊 root llms 導航、四項 CI 全部成功的候選：`46b38c2703d1d5b941fc091ec67df8e0949ad022`。
- CI 使用 GitHub 自動產生的 PR 測試合併快照 `8e6da0616a4bee645b44aeff18a0a03f309b28fd`；這不是合併到 main 的操作。基準 main 仍為 `244c7f7b416508aedd8f5f8d4a082ae2bb17d022`。

| Workflow | 結果 | 來源 |
| --- | --- | --- |
| Gameplay pattern catalog | success | [run 41426641034](https://github.com/fallrising/newclear/actions/runs/41426641034) |
| Project success contracts | success | [run 41426641185](https://github.com/fallrising/newclear/actions/runs/41426641185) |
| llms.txt CI | success | [run 41426641051](https://github.com/fallrising/newclear/actions/runs/41426641051) |
| Workflow static validation | success | [run 41426641581](https://github.com/fallrising/newclear/actions/runs/41426641581) |

已回讀 catalog job `125214721973` 完整日誌。Ubuntu 24.04、Python 3.11.17 的實跑結果：metadata 14 篇通過、18 項單元測試通過、靜態建置與 JavaScript 語法通過、53 個專案契約通過、PROJECTS 重建無差異、9 個 llms 檔案零錯誤。2026-11-02T10:11:46Z 完整瀏覽器測試成功。

完整模式使用真瀏覽器與 HTTP `/nested/catalog/` 子路徑，實際點擊詳情、相關模式與 metadata 頁；測試搜尋、分類交集、NFKC、空結果、清除、逐篇來源、390px 無水平溢出及無 JavaScript 導航。沒有 pageerror 或頁面外部請求。這補足本機環境無法導航的缺口，不把 render-only 當完整測試。

## 本機實跑與限制

環境：Python 3.13.5、Node 22.16.0、Playwright 1.57.0、環境提供的 Chromium。建置 runtime 只用 Python 標準函式庫，瀏覽器 QA 套件不屬 runtime 依賴。

| 檢查 | 結果 | 證據摘要 |
| --- | --- | --- |
| `python3 build.py --check` | passed | 14 篇、13 個分類；欄位、來源末節、關聯與日期一致 |
| `python3 -m unittest discover -s tests -v` | passed | 18 tests；危險 URL、JSON 重複欄位、來源錯配、HTML escaping、輸出保護、symlink、確定性與本地 HTML 連結 |
| `python3 build.py` | passed | 14 詳情頁、首頁、metadata 頁與 JSON；兩次建置逐檔 SHA-256 相同 |
| `node --check app.js` | passed | 原生 JavaScript 語法檢查 |
| JSON Schema 2020-12 額外檢查 | passed | 本機 jsonschema 驗證 14 個 frontmatter；未加入 runtime |
| Python HTTP client | passed | 19 個生成資源為 HTTP 200 且非空；不是瀏覽器導航 |
| `python3 tests/browser_smoke.py --render-only` | passed | 真 Chromium 渲染建置 bytes，驗證 DOM、CSS、JS、390px 和 no-JS 內容；不驗證 URL 導航 |
| 本機完整瀏覽器導航 | blocked | `net::ERR_BLOCKED_BY_ADMINISTRATOR`，HTTP／file URL 皆受政策限制；沒有繞過政策，完整模式已於上述 CI 補驗 |
| 本機全 repo 索引 | not run | 無完整 checkout；上述 CI 以完整 repository 成功執行 |

## 首輪 CI 失敗與修正

[run 41425866755](https://github.com/fallrising/newclear/actions/runs/41425866755) 在實作 commit 的 metadata、18 項測試、建置及專案契約均成功，但 `check_indexes.py` 報 `llms.txt: root index does not link catalog component tools/gameplay-pattern-catalog`，因此當輪瀏覽器步驟被跳過。

修正只新增 root llms 的元件入口並更新任務活動時間，未刪除檢查或把 skipped 改作通過。重新觸發的四項 CI 全部成功，詳見上表。

## 內容來源

13 篇核對 Gameplay Atlas 公開頁面文字摘錄；commerce-price-discovery 的直連頁面當次只回傳開啟提示，因此採用搜尋索引摘錄，sources.access_method 明列為 search-index-excerpt。查閱日期是本次讀取日期，不推定為來源發表／更新日。每篇最後一節提供具體機制頁 canonical URL。

網站自述的 280／28 是帶日期的來源範圍；實際收錄為 14／13。沒有全站盤點、原遊戲執行、原站完整互動頁驗證、圖片或全文下載。原創 prototype 的數字不是來源遊戲參數。

## 提交與回讀

終端 `git ls-remote` 因 `Could not resolve host: github.com` 失敗；GitHub App 讀寫成功。使用 tree → 原子 commit → 非 force、帶 expected_sha 的 fast-forward update_ref，每次更新保留最新基準與回讀。

實作的 34 個元件檔案經本機計算 Git tree `2ee39bb810a7abc8c19b5376b715df3544b95aef`，與遠端完全一致；root README／PROJECTS／inventory／workflow 的 blob SHA 也一致。root llms 修正前先核對完整基準 blob，修正後遠端與本機同為 `39457815ef55011b393ba3142fde8046853e5f03`。runtime、筆記與測試內容另以 [checksums.json](checksums.json) 固定；交付文件可後續補充 CI 證據。

自動驗證成功不等於 owner 審查或獨立 review。Draft PR 未合併，任務維持 in_progress，沒有 usable tag。
