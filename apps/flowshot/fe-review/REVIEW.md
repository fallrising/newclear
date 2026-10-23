# FE Review — flowshot — REVIEW

> 活文件：記目前狀態，每次變更走 PR；依 [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)。

## 目前輪次

- **第 1 輪：DESIGN 已草擬，待 owner 確認**，見 [DESIGN](DESIGN.md)。AC-11 是 paired 交付，AC-15 人工確認尚未完成。
- 第 2 輪修改、fixture/driver 實作與第 3 輪 capture 均未開始；`targets.json` 仍 `verified: false`。

## 修改權限

Flowshot 已由 owner 於 2026-10-23 恢復主線開發，見 [README](../README.md)。本 paired FE 設計仍只依 #156 做受限 frontend review，不加新功能、不做 major 升級，也不介入其他主線任務。

## 矛盾點

### C1 Browser 缺 native IPC，且 generic capture 沒有 preload hook

原始碼仍需 Tauri invoke；browser dev server 不等於已解耦。[capture.mjs:114](../../../docs/fe-review/capture.mjs#L114) 建立自己的 context/page，未載入 `addInitScript` fixture。DESIGN 的 review-only driver 是未來交付，不是已存在的啟動入口。

### C2 產品旅程描述超前主畫面

[App.tsx:55](../src/App.tsx#L55) 仍為 build-info shell，[render.tsx:15](../src/render.tsx#L15) 只 mount App。workspace/reader 模組已部分存在，但不是此入口的完整閱讀／annotation 產品旅程。PROMPT 改為 foundation 三狀態；保留產品主線缺口，不以 mock 新造 annotation UI。

### C3 Web capture 與原生驗收不同

Linux native/Xvfb 已有其他驗證，不應再寫成 headless 必然無法擷取。browser-only 截圖仍無法證明真 IPC、資料持久、原生視窗或 Mac 時限；D2 只決定本 FE 切片是否要求 native screenshot，不取消產品 gate。

## 已決定

- #156 允許 paired、design-only 交付；本輪不啟動 UI、不改 product code/tests/dependencies/CI。
- 尚無 D1／D2 的 owner 確認；不因 draft 存在或靜態檢查通過而移為已決定。

## 需要放開或決定的點

### D1 IPC 解耦方式

- 選項：(a) production frontend IPC adapter；(b) review-only `addInitScript` preload。
- 建議／本 DESIGN 假設：(b) 先行。優先用現有 build-info window promise seam，不改生成 contracts。
- 狀態：**待擁有者決定**；若 (b) 不可行，先修 DESIGN 再確認，不自行改為 (a)。

### D2 是否要求原生視窗截圖

- 選項：(a) 本 FE 切片加受控 native screenshot；(b) 本輪只 Web 層並列限制。
- 建議／本 DESIGN 假設：(b)。原有 Mac/原生產品驗收不因此豁免。
- 狀態：**待擁有者決定**。

## 進入第 2 輪的條件

- Owner 明確確認每個 D 假設並完成 AC-15；不得單憑任意 agent merge 推定 signoff。
- [DESIGN](DESIGN.md) 範圍已確認；依其 M 項完成 fixture/driver、隔離先備與測試後，才可真正啟動 capture 並更新 targets。
- PROMPT 的 proposed/unrun 線索需回填真實 CLI、環境、source SHA 和結果，不能先改 verified true。

## 相關 PR

- fallrising/newclear#141：建立工作包與三輪節奏。
- fallrising/newclear#144：既有決定與設計文件入口。
- 本次 paired 設計：Refs [#156](https://github.com/fallrising/newclear/issues/156)；PR 尚待 orchestrator 建立並回填，不捏造編號，不自動關 issue。
