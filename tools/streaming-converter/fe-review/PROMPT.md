# FE Review Prompt — streaming-converter

你是負責 **streaming-converter** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**暫緩（退役）**。擁有者決定退役元件不進入第 2、3 輪；本檔只保留供日後恢復時參考。見 [REVIEW.md](REVIEW.md)。

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

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs tools/streaming-converter/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs tools/streaming-converter/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
