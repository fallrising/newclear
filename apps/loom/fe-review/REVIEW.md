# FE Review — loom — REVIEW

> 活文件：記目前狀態，每次變更走 PR；依 [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)。

## 目前輪次

- **第 1 輪：DESIGN 已草擬，待 owner 確認**，見 [DESIGN](DESIGN.md)。AC-11 是 paired 交付，AC-15 人工確認尚未完成。
- 第 2 輪修改、fixture/driver 實作與第 3 輪 capture 均未開始；`targets.json` 仍 `verified: false`。

## 修改權限

文檔檔位 **C（dormant）**，依 [PORTFOLIO](../../../PORTFOLIO.md) 的 FE review 例外，第 2 輪只做已確認 DESIGN 範圍，不恢復 backlog、新功能或 major 升級。

## 矛盾點

### C1 Browser 缺 native IPC，且 generic capture 沒有 preload hook

原始碼仍需 Tauri invoke/listen；browser dev server 不等於已解耦。[capture.mjs:114](../../../docs/fe-review/capture.mjs#L114) 建立自己的 context/page，未載入 `addInitScript` fixture。DESIGN 的 review-only driver 是未來交付，不是已存在的啟動入口。

### C2 Native 邊界不只在 src/ipc.ts

[doc_ipc.ts:24](../src/surfaces/document/doc_ipc.ts#L24)、[ai_ipc.ts:37](../src/surfaces/document/ai_ipc.ts#L37)、[persistence.ts:78](../src/surfaces/canvas/persistence.ts#L78) 與 [window_close_ipc.ts:5](../src/surfaces/canvas/window_close_ipc.ts#L5) 都直接 invoke/listen。僅 mock PTY 不足以跑 document、canvas/history 或 close 保護；需要完整 command/event registry 與 reset/disposal。

## 已決定

- #156 允許 paired、design-only 交付；本輪不啟動 UI、不改 product code/tests/dependencies/CI。
- 尚無 D1 的 owner 確認；不因 draft 存在或靜態檢查通過而移為已決定。

## 需要放開或決定的點

### D1 IPC 解耦方式

- 選項：(a) production frontend IPC adapter；(b) review-only `addInitScript` preload。
- 建議／本 DESIGN 假設：(b) 先行。需完整 invoke/listen/callback 與事件生命週期；不是只設 window.invoke。
- 狀態：**待擁有者決定**；若 (b) 不可行，先修 DESIGN 再確認，不自行改為 (a)。

## 進入第 2 輪的條件

- Owner 明確確認每個 D 假設並完成 AC-15；不得單憑任意 agent merge 推定 signoff。
- [DESIGN](DESIGN.md) 範圍已確認；依其 M 項完成 fixture/driver、隔離先備與測試後，才可真正啟動 capture 並更新 targets。
- PROMPT 的 proposed/unrun 線索需回填真實 CLI、環境、source SHA 和結果，不能先改 verified true。

## 相關 PR

- fallrising/newclear#141：建立工作包與三輪節奏。
- fallrising/newclear#144：既有決定與設計文件入口。
- 本次 paired 設計：Refs [#156](https://github.com/fallrising/newclear/issues/156)；PR 尚待 orchestrator 建立並回填，不捏造編號，不自動關 issue。
