# 驗證入口

`python3 -m unittest discover -s tests -v` 執行標準函式庫測試。

`python3 tests/browser_smoke.py` 使用真 Chromium 和本機 HTTP 驗證完整瀏覽器導航；需額外安裝 Playwright 與瀏覽器。

`--render-only` 只把實際生成頁面載入 Chromium，驗證 DOM、CSS、JavaScript 和 no-JS 內容；URL 導航未測，不得冒充完整 smoke。詳見 [驗證紀錄](../docs/verification.md)。
