# FE Review — streaming-converter — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **暫緩（退役）** — 不進入第 2、3 輪；恢復需要擁有者在 `PORTFOLIO.md` 另行決定。

## 修改權限

文檔檔位 **D（retired）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，退役元件**暫緩**，不進入第 2、3 輪。本檔保留目前已知的矛盾點，供日後恢復時參考。

## 矛盾點

### C1 hls.js 由 CDN 載入

隔離環境的出站網路可能擋 CDN，播放器無法初始化；改為本機載入屬變更。

### C2 需要 ffmpeg 產生測試片段

容器需安裝 ffmpeg。

## 需要放開或決定的點

暫緩期間不處理。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
