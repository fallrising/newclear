# FE Review Prompt — streaming-converter

你是負責 **streaming-converter** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `tools/streaming-converter/`
- **一句話：** FFmpeg HLS 轉檔工具的網頁播放器：單頁 HTML，透過 CDN 載入 hls.js。
- **技術棧：** 單頁 HTML、hls.js（CDN）
- **UI 入口：** `www/index.html`

## 啟動線索（未驗證）

- 以 `python3 -m http.server 8088 --bind 127.0.0.1 --directory www` 提供靜態檔。
- 用 ffmpeg 產生幾秒的測試片段作為 HLS 來源；若環境封鎖 CDN，記錄在報告，並評估改為本機載入（屬變更，需提議）。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 開啟播放器 → 載入 HLS 來源 → 播放 → 錯誤來源

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 播放器控制項的鍵盤操作與 label。
- 載入失敗的錯誤訊息。
- mobile 寬度下的影片比例。

## 可重用的既有資產

- （無）

## 待補的頁面

無。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs tools/streaming-converter/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs tools/streaming-converter/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
