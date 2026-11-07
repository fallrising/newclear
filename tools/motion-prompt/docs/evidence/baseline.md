# 來源與實測基準

本頁固定可追溯基準，**不是本次整合驗收完成報告**。

## 來源

- newclear 本次規格基準：`f16dc2bb825ab1c85e5a68416aa46e80c58902b4`；已讀 root AGENTS、README、taxonomy、portfolio-doc-tiers、PORTFOLIO、work-tracking、monorepo-ci、project-success 與 llms-txt 契約。
- 既有實作 Git tree：`9f17c9d7556b7e390dc7b09dcdb5b00fad083048`；原 base `2c0cb8c4c10848d3b818d11bbee46299dca6d894`。tree 不是已發布 commit。[Git tree](https://api.github.com/repos/fallrising/newclear/git/trees/9f17c9d7556b7e390dc7b09dcdb5b00fad083048)。
- 上游固定版本：[770eefb7091cc725ab0eb6d4ef5cbf28b28e282c](https://github.com/showheyohtaki/motion-prompt/tree/770eefb7091cc725ab0eb6d4ef5cbf28b28e282c)。其 README、FORMAT、CONTRIBUTING、LICENSE、THIRD-PARTY-NOTICES、make-your-own、metadata、Canvas、builder 與 checker 已於原匯入時完整讀取。
- 2026-10-28 查到的新 HEAD `bd6bf08d8d412cc82c1bbc8f1a81638617a45cfb` 不屬於本輪固定匯入；不把 120 項覆蓋率延伸到新 HEAD。

## 既有實跑（保留日期）

2026-10-16，Node 24.19.0／Playwright 1.62.1／真實 Chromium 153.0.8010.0：

- `node tools/build.mjs`、`--check`：120 項、517 產生檔，無 stale。
- `node tools/validate.mjs`：全部雙語欄位、穩定識別、原文來源、612 條規格數字與單位通過。
- `node tools/contract-test.mjs`：重複建置位元組一致；缺繁中、改規格數值與 stale 負例被拒絕。
- `node tools/browser-test.mjs`：41 項真實瀏覽器行為、480 個端點，零資源錯誤與外部 runtime 請求。保留的 [原始摘要](browser-results-20261016.json) 對應上述 tree，不代表這份規格分支。
- `node tools/check.mjs --strict` 與 `--lang en --strict`：各 120 項，0 failure、0 warning；固定上游基準同樣通過。每項 8 個時間點及 seam／重複像素／2× context 檢查。
- 桌面／手機／LP／攝影六張截圖已於當時實際開啟檢查；手機為 Chromium 390×844 模擬，不是實機。

2026-10-27 復原同一來源：557 個元件 blob SHA 一致（0 差異），`node tools/build.mjs`、`npm run check`、Python HTTP 啟動 200 通過。最初獨立目錄缺 monorepo 上層政策文件造成檢查失敗；補足文件上下文後通過，沒有改程式避開檢查。

## 限制與待驗

既有結果支持 SDD 的行為預期；最新主線整合、完整翻譯人工複核與 AC-13 交付仍未通過，不把歷史計數當成新版本驗收。Safari、Firefox、實體手機及部署後託管站點未驗證。標準 Chromium 下載曾回傳非 ZIP，當時改用本機 Chromium，未宣稱標準下載成功。

上游提問例句參數可能與示範實作不同，需分開呈現；攝影畫布為示意圖，不能將其當成精確光學模擬。這些界線保留來源，實作時仍需核對是否新增回歸。
