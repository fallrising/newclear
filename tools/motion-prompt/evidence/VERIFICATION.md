# 驗證紀錄 — 2026-10-28

已完成完整網站整合與本地自動驗證；網站實作交付 Draft PR，owner 最終驗收另計，未合併實作、未部署、未建立 usable tag 或新 CI。歷史證據另見 [2026-10-16 紀錄](VERIFICATION-20261016.md)，不當作本輪測試。

## 來源與環境

整合基準：newclear `fb58656083231c282a64baf20602aa662caf4eee`（已批准規格 PR #708）。本輪公開規範來源為此 SHA 的 root／component AGENTS、README、taxonomy、portfolio-doc-tiers、work-tracking、monorepo-ci、project-success、llms-txt 契約；沿用同一固定 SDD AC-01–AC-13，沒有改驗收門檻。

上游 checkout：`770eefb7091cc725ab0eb6d4ef5cbf28b28e282c`；18 個來源鎖定檔的 SHA-256 全部一致；5 packs 各 24 項共 120 項，兩語完整率 100%，612 條配對規格。上游新 HEAD 的差異與選版理由見 [UPSTREAM](../UPSTREAM.md)。

Linux x64、Node.js v24.22.1、Python 3.12.14、Playwright 1.62.1、Chromium 153.0.8010.0；桌面 1440×1000、手機 390×844 touch emulation。測試主機使用 Noto Sans CJK TC，瀏覽器及字型不納入網站。沒有 DOM stub 或 mock clipboard。

## 實際命令與結果

| 命令 | 結果／AC |
| --- | --- |
| `python3 -m http.server 8000 --bind 127.0.0.1` | 啟動並讀取首頁 HTTP 200、zh-Hant；AC-13 |
| `npm ci --ignore-scripts --no-audit --no-fund` | 元件目錄安裝 2 個開發測試套件成功 |
| `node tools/build.mjs` | 120 項、517 個產生檔；AC-11 |
| `npm run check` | 無 stale outputs；120 項雙語、612 條規格數值／單位、ID／slug、原英文／日文資料 hash、授權／本地連結通過；連續建置位元組一致，缺譯／改數字／stale output 負例全部拒絕；AC-01/02/03/11/12 |
| `npm test`（下述本機 Chromium 選項） | 資料、44 項真實瀏覽器檢查及兩語各 120 項動畫全通過；AC-01–12 的自動部分 |
| `node tools/browser-test.mjs` | 最後調整截圖捲動位置後重跑 44 項通過；480 API 端點 HTTP 200，零錯誤／外連；AC-04–10 |
| `node tools/check.mjs --root <固定上游 checkout> --strict --report evidence/animation-upstream.json` | 原版 120 項，0 failure／0 warning；AC-08 |
| `python3 scripts/check_project_success.py --write-index`（repo 根） | 45 個契約；AC-13 |
| `python3 scripts/check_indexes.py`（repo 根） | 45 個契約、7 個 llms.txt，0 errors；AC-13 |
| `git diff --cached --check` | 全部新檔與修改檔 whitespace 通過；AC-13 |

瀏覽器命令使用 `MP_BROWSER_OPTIONS` 指向含 `executablePath` 的本機 launch 選項 JSON，`FONTCONFIG_FILE` 指向測試主機字型設定。可攜使用者安裝方式見 README；這些本機路徑不是執行網站的需求。

本輪失敗與處理：第一次 npm ci 在錯誤的上層工作目錄執行，無 lockfile；移至元件目錄成功。標準 `npx playwright install chromium` 仍下載非 ZIP，未宣稱成功；以測試專用 @sparticuz/chromium 153.0.0 取得本機 Chromium。該套件預設 tar 解包的 chown 在環境失敗，改為不改擁有者的解包方式；其 single-process 選項導致動畫 checker 切換 page 後瀏覽器關閉，移除此測試主機選項後全部通過，未修改網站或降低測試條件。以上工具／瀏覽器／字型均未加入產品依賴。

## 證據與解讀

- [44 項瀏覽器結果](browser-results.json)：搜尋繁中／英文／編號、pack／分類／空結果、保留搜尋／選取／備註、深連結及重載、兩語單項／多選真實剪貼簿、分享／清除、鍵盤焦點、手機、即時 reduced-motion、根路徑及巢狀子路徑、480 端點與零非必要外連。
- [繁中動畫](animation-zh-Hant.json)、[英文動畫](animation-en.json)、[固定上游對照](animation-upstream.json)：各 120 項，在 8 個時間點繪製，另查 loop seam、重複時間像素一致性與 2× scaling，均 0 failure／0 warning。原設計進場前的背景影格列為 info，沒有當成新增空白回歸。
- 實際開啟並檢視 [桌面繁中](desktop-zh.png)、[英文詳情](desktop-en-detail.png)、[手機首頁](mobile-zh.png)、[手機詳情](mobile-zh-detail.png)、[網頁畫布](desktop-lp.png)、[攝影畫布](desktop-photo.png)：文字可讀、控制項無重疊、手機無水平溢出。畫布截圖在 reduced-motion 的固定中段顯示。
- AC-03 人工核對 120 個術語名稱；重點交叉核對 dolly／zoom／dolly zoom、視差與 LP 放大／轉場規格。數值／單位檢查逐條覆蓋 612 條，但不是全面語意品質的自動證明；翻譯自然度與視覺適切性仍待 owner 最終確認。
- AC-12：保留 MIT、原作者與第三方聲明；來源 Canvas 可散布，沒有匯入第三方社群貼文、照片、影片、字型或宣傳二進位；沒有執行時上游下載、後端、LLM API、追蹤或新增付費服務。

既有上游界線：提問例句參數可與示範規格不同，UI 分開標示；攝影是示意 Canvas，例如蝴蝶光的無五官人物用下巴陰影表現，與理論鼻下陰影的說明不同。保留原設計並揭露，未擴張成攝影渲染器重寫。

未驗證：Safari、Firefox、實體手機及已部署託管環境。手機結果為 Chromium 模擬；沒有宣稱 owner 已驗收。實作 commit／Draft PR 的不可變來源及遠端回讀結果列於 PR 與任務報告，避免在 commit 內容中自我引用其 SHA。
