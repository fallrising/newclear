# Motion Prompt｜動態與視覺術語圖鑑

> 文檔檔位：**未分級**；依 [portfolio 文檔政策](../../docs/portfolio-doc-tiers.md)，不自行設定長期投入檔位。本次交付為可本地執行的改作，等待 owner 最終驗收；未發布網站。

驗收範圍與進度見 [SUCCESS.md](SUCCESS.md)，固定條件見 [SDD.md](SDD.md)。

看得到想要的動畫或視覺效果，卻不知道如何向 AI 描述？此圖鑑提供 **5 個分類組、120 項動態示範**，包含繁中＋英文名稱、意思、使用情境、提問例句與實際規格。保留上游的編號、slug、英文資料與 Canvas 動畫。

繁中預設，可切換英文。搜尋繁中、英文、關鍵字或 `#005`；按分類篩選、點擊查看詳情，或用 `?lang=en#028` 深連結。單項與多選提示詞皆可獨立選擇繁中／英文，包含完整規格，可附用途備註。切換介面不清空搜尋、選取或備註。支援鍵盤、手機、深淺色與 `prefers-reduced-motion`。

## 本地啟動

從 monorepo checkout：

```sh
cd tools/motion-prompt
python3 -m http.server 8000 --bind 127.0.0.1
```

開啟 <http://127.0.0.1:8000/>。已提交產生檔，瀏覽不需要安裝 Node 套件或下載上游。也可從 monorepo 根目錄執行相同伺服器，開啟 <http://127.0.0.1:8000/tools/motion-prompt/>；資源與複製的本地網址支援子路徑。不要以 `file://` 開啟，程式碼詳情需要本地 HTTP。

不需要帳號、後端、資料庫、LLM API、付費服務或外部字型；不含追蹤與社群嵌入。系統字型需能顯示繁中。原始碼連結屬明確的外部參考，不是執行時依賴。

## 建置與測試

建置需要 Node.js 20+，不需要額外套件：

```sh
node tools/build.mjs
node tools/build.mjs --check
node tools/validate.mjs
```

真實瀏覽器測試需要 Node.js 20+、Playwright 及 Chromium：

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test` 執行 generated-output／完整性檢查、真實 Chromium 行為測試，以及繁中／英文的全部動畫檢查。測試自行啟動本地 HTTP、使用真實 Clipboard API，不需要另開伺服器。截圖與摘要預設輸出至 `evidence/`；可用 `MP_EVIDENCE` 指定臨時目錄。

也可單獨執行：

```sh
node tools/browser-test.mjs
node tools/check.mjs --strict
node tools/check.mjs --lang en --strict
```

環境可用 `MP_PLAYWRIGHT=/absolute/path/to/playwright` 指向既有測試套件；`MP_BROWSER_OPTIONS=/absolute/path/options.json` 可提供 Playwright `chromium.launch` 選項，例如既有 Chromium 的 `executablePath`。本次環境的標準瀏覽器下載回傳非 ZIP，改用本機 Chromium 完成測試；標準下載方式未在此環境成功，實際版本、命令與結果見 [驗證紀錄](evidence/VERIFICATION.md)。測試用瀏覽器及字型不隨元件發布。

## 維護與來源

修改 `packs/*/meta.json` 或 `locales/*.json`，再重新建置；不要手改產生的 catalog、API、pack 程式與 Markdown 清單。資料契約與輸出路徑見 [FORMAT.md](FORMAT.md)。提問例句與實際示範規格分開保存，不能將例句參數當成示範實作。

本地不匯入或宣稱支援上游 Skill／CLI／agent bridge。直接使用網站與靜態提示詞即可；本地 API 是檔案，沒有服務端。

- [全部術語清單](packs/README.md)
- [來源、完整 SHA、匯入範圍與同步方法](UPSTREAM.md)
- [MIT License](LICENSE) · [第三方聲明](THIRD-PARTY-NOTICES.md)

原作者 **Shohei Ohtaki**。此版本由 newclear 維護，並非原作者官方繁中版。
