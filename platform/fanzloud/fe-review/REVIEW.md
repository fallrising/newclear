# FE Review — fanzloud — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採靜態資產＋有限假 API/WS，不新增 production fake-runner 或連真 Cloud。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 control-plane 啟動需要雲端 runner 設定

`apps/control-plane/src/main.rs:42–85` 要求 validated runner／私有目錄／Cloud scope／HTTPS origin／bootstrap；留空不是 fake 模式。`p0-client.js:573–588` 要求 HTTPS，:1314 建立 WSS，原 targets 的 HTTP URL 無法走正常 operator 流程。既有 T007 的 fake CLI 組合驗證不是現成的 screenshot server；專用 harness 見 DESIGN M1，目前未實作。

### C2 既有響應式與 dark 樣式待實測

`p0.css:75–78,123–136,157–164` 已有 shell/grid/wrap 與事件/diff 捲動；沒有 light theme。長資料、鍵盤、對比與狀態播報須實測，不能先宣稱已破版或 axe 失敗。

### C3 主要流程有明確 mutation 與秘密邊界

`p0-app.js:118–144` 的 authenticate、device login、submit、cancel、diff、logout 不是頁面切換。DESIGN M3 使用有限 mock、合成內容及本次 browser state；不允許真 runner、憑證或 Cloud 呼叫，亦不把 mock 視作 production auth 驗收。

## 本次確認的決定

### D1 解耦方式

- 選項：(a) control-plane 提供本機 fake runner 模式（只收窄，不連雲端）；(b) 靜態檔＋最小假 API。
- 建議：(b) 先行；(a) 屬後端變更，需擁有者決定。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- issue [#159](https://github.com/fallrising/newclear/issues/159)：本次草稿；PR 由 parent 另行建立，D1 已由 owner 確認。
