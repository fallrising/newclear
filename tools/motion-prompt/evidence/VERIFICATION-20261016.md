# 驗證紀錄 — 2026-10-16

本地實作與自動驗證完成；owner 最終驗收另行進行。未 merge、未 deploy，沒有新增 CI 或外部服務。

基準：newclear `2c0cb8c4c10848d3b818d11bbee46299dca6d894`；上游 `770eefb7091cc725ab0eb6d4ef5cbf28b28e282c`。本次讀取的公開規範為該 newclear SHA 的 AGENTS、README、taxonomy、portfolio-doc-tiers、PORTFOLIO、work-tracking、monorepo-ci 與 llms-txt 契約；上游 README、FORMAT、CONTRIBUTING、LICENSE、THIRD-PARTY-NOTICES、make-your-own 及其翻譯提示、實際建置與動畫程式均以固定 SHA 為準。私人治理只使用規範允許的抽象引用。

環境：Linux x64；Node.js v24.19.0；Python 3.12.14；Playwright 1.62.1；真實 Chromium 153.0.8010.0。為目視檢查配置本機 Noto Sans CJK TC 系統字型，未將字型或瀏覽器加入元件。未使用 DOM stub 或 mock clipboard。

| 實際執行命令 | 結果 |
| --- | --- |
| `python3 -m http.server 8000 --bind 127.0.0.1` | 本地靜態伺服器啟動；瀏覽器測試另自動建立有子路徑的 HTTP 伺服器 |
| `npm ci --ignore-scripts --no-audit --no-fund` | 安裝 2 個開發測試套件成功 |
| `node tools/build.mjs` | 5 packs／120 項，產生 517 檔案 |
| `node tools/build.mjs --check` | 無缺檔或 stale outputs |
| `node tools/validate.mjs` | 120 項雙語完整、來源／ID／slug／英文名稱一致、612 條規格數值與單位一致、提問與說明的數字一致、本地 API 路徑正常 |
| `node tools/contract-test.mjs` | 重複建置位元組一致；缺繁中、數值改動與 stale output 的負例均被拒絕 |
| `npm test`（指定本機瀏覽器選項） | 全部資料、瀏覽器與兩語動畫檢查通過 |
| `node tools/browser-test.mjs` | 41 項真實 Chromium 行為檢查；480 個雙語規格／提示詞 HTTP 端點回傳 200 |
| `node tools/check.mjs --strict` | 繁中 120 項：0 failure、0 warning |
| `node tools/check.mjs --lang en --strict` | 英文 120 項：0 failure、0 warning |
| `node tools/check.mjs --root <固定上游 checkout>` | 上游 120 項：0 failure、0 warning；使用相同檢查演算法與瀏覽器 |
| `node tools/check.mjs --pack lp --strict`、`--pack lp --lang en --strict` | 畫面審查後修正分段文案的語序與空格，受影響的兩語各 24 項重新通過 |
| `python3 .github/scripts/validate_llms_txt.py`（monorepo 根目錄） | 5 個 capability files，0 error |
| `git diff --cached --check` | 通過 |

測試環境變數：`MP_BROWSER_OPTIONS` 指向含 `executablePath` 的本機 Playwright launch 選項 JSON；`FONTCONFIG_FILE` 指向本機繁中字型設定。使用既有測試套件時也驗證過 `MP_PLAYWRIGHT`。這些位置不屬於可攜交付物。

`playwright install chromium` 的標準下載在此環境回傳 HTML「Site Unavailable」，解壓失敗；未宣稱標準下載成功。改用可用的本機 Chromium 完成真正瀏覽器驗證。Safari、Firefox、實體手機與已發布的託管站點未驗證；手機證據是 Chromium 390×844 viewport／touch emulation。

瀏覽器涵蓋：繁中預設／英文切換、雙語與編號搜尋、分類與空結果、單項詳情／深連結、兩語真實剪貼簿、多選完整規格與備註、分享連結、切換語言不丟失狀態、鍵盤 Enter／Esc／方向鍵與焦點返回、動態播放、初始及即時 reduced-motion、桌面／手機、主題切換。零 console error、page error、未處理 rejection、失敗請求或 404；核心流程零非必要對外請求。

動畫檢查對每項取 8 個時間點，另檢查循環邊界、相同時間的像素確定性與 2× context scaling。上游與本地皆無接縫警告；進場前只有背景的影格被列為原設計資訊，不當成回歸。完整數值見 [animation-results.json（歷史）](animation-results.json)；行為摘要見 [歷史瀏覽器摘要](../docs/evidence/browser-results-20261016.json)。

當時六張截圖曾實際目視；目前同名截圖已由最新整合驗證更新，請以 [最新紀錄](VERIFICATION.md) 為準。
