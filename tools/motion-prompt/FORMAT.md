# 資料與建置契約

此檔說明本地改作；原始契約見固定版本的 [上游 FORMAT.md](https://github.com/showheyohtaki/motion-prompt/blob/770eefb7091cc725ab0eb6d4ef5cbf28b28e282c/FORMAT.md)。

- `packs/<pack>/meta.json` 是術語的單一來源。保留原始 `en`、`ja`，所有 title、category、name、meaning、ask、summary、use 與 spec 必須具有完整 `zh-Hant`、`en`。spec 是語言到字串陣列的映射；逐條順序對應，不允許缺項或英文備援。
- pack order、局部兩位 no、slug、英文名稱與分類對應固定在 `upstream-lock.json`。全域三位 ID 依既有 pack order／no 產生，不能重新編號。
- `packs/<pack>/source.js` 是原始動畫，位元組保持上游不變。`locales/canvas.json` 管理畫布文字；每個值依序為 `[繁中, 英文]`。英文 SP/I/N 使用三個字群，保留原三字錯開時間；打字機兩語均為九個字元。縮放、軌跡、時間及緩動程式未變更。
- `locales/ui.json` 管理介面文字；`site.template.html` 是頁面結構。`assets/site.js` 是沿用上游的純 JavaScript 互動層，無框架或執行時外部依賴。
- `tools/build.mjs` 產生 `index.html`、`assets/{catalog,locale}.js`、兩語 pack 程式、`api/v1/**` 與 `packs/**/README*.md`。不可手改這些輸出。`--check` 比對預期內容並拒絕過期／多餘 API 檔案。
- API：`api/v1/{zh-Hant,en}/p/<id>.txt` 為完整提示詞；`e/<id>.txt` 為規格與元素程式；共用程式在 `api/v1/kit/<lang>/<pack>.js`。靜態提示詞中的 `./` 以圖鑑根目錄為基準；網站複製時使用目前圖鑑的完整網址，保留託管子路徑。
- 英文 metadata 原文可由 hash 驗證；產生的英文內容只將日本語畫布標籤與「in Japanese」等標籤註記正規化為本地示範用語。術語、例句參數及規格數值不變。
- `tools/validate.mjs` 檢查來源 hash、全部 120 項對應、雙語完整性、612 條規格的數值／單位集合、API 路徑與漏出的日文。數值集合逐條比較，允許中文語序；方向與語意另以原始英日說明及動畫程式人工核對。

新增或同步內容時，先更新來源鎖與 metadata／locale，再 build、check、真實瀏覽器及兩語動畫測試。只更新來源鎖不能代替內容審核。CLI、Skill、agent bridge 不在本地支援面。
