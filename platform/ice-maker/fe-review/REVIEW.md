# FE Review — ice-maker — REVIEW

2026-10-23 owner 已確認維持內嵌頁面與 review-only 合成 extractor；[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)。

## 目前輪次

第2輪原批准 M1–M4 已實作、必要本機驗證已齊，等待獨立 acceptance 與 exact-head CI／merge。第3輪完整報告未啟動；產品主線 AC-04 與 usable_tag 未改。[實測報告](tasks/round2/report.md) 保留全部失敗及補證。

## 已解決事項

- C1：review fixture 注入既有合成 extractor、真 FastAPI／durable service，固定 loopback；不用正式 OCR／CLI／relay，也不改 API 或 DB。
- C2：維持 `_PAGE` 與 `render_html` 內嵌方式，不抽 package data，不新增依賴；原禁用字串與 escaping/cap 測試通過。
- C3：加入外殼、system colors、focus與stacked fields。上傳與poll失敗可見且停止poll，busy恢復，languages trim/filter/sort；30分鐘 UI-only 上限不取消後端工作。
- C4：結果頁固定外殼有 lang/meta/h1/back 與長行換行，保留 escaped Markdown 與下載；+535 bytes，末端大小上限與精確邊界測試保留。

## 實測發現與限制

18 matrix records 與18 axe scans皆無overflow／pageerror／consoleerror／requestfailure／axe violation或incomplete。真實400是輸入驗證；其他400 literal、404／409／network／invalid poll與clock為明示受控補證。

首次 runtime 的立即 enabled 斷言早於 documents response／finally，是 harness 等待時機失敗；後續 focused fresh-state flow 通過。另獨立 completed-only receipt 證明停留頁面時 GET count不再增加。沒有重跑已綠matrix或為此修改產品。

原生320 tests有1個 inherited invalid SSH agent 環境失敗，清除該變數後原test單獨通過；exact-head完整CI仍必須通過。首次工具mount探測失敗與修正由root保留，未算產品失敗。

30分鐘cap只以browser clock補證，沒有等待實際30分鐘；真OCR／provider、200%zoom、完整手動keyboard／assistive technology與第3輪未宣稱。截圖與raw logs/state不公開。
