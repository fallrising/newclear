# FE Review Prompt — flowshot

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採 review-only preload；D2 本 FE 切片做現有 shell 的 Web 截圖，原生／Mac 產品 gate 不變。 第 2／3 輪仍未由本次文件回寫執行。
先讀 [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)、[REVIEW](REVIEW.md)、[DESIGN](DESIGN.md) 與 [SUCCESS](../SUCCESS.md)。本工作包是 **第 1 輪設計方向已由 owner 確認**；不啟動、不修改程式碼、不跑 capture。

## 專案與目前入口

- `apps/flowshot`；React19/Vite8/Tauri2，Node24.18.0。Flowshot 已恢復主線開發，但此 FE 切片不擴張產品功能。
- 目前 App 是 foundation build-info shell，loading／ready／error 由 App.tsx:25–102 呈現。workspace/reader 模組存在不等於已接上閱讀與 annotation 全旅程。
- 唯一頁面 `/`，Vite loopback1420。未有 dark theme 切換；兩種 color preference 是測試條件，不是功能宣稱。

## 啟動先備（提案，全部未執行）

目前 **未 capture-ready**。`targets.json` 只描述 dev server 與 `/`，`verified: false`；它不會裝 IPC mock。共用 capture.mjs 沒有 addInitScript hook，不能單獨執行就聲稱完成下列流程。DESIGN 的本元件 review fixture/driver 仍須第 2 輪實作與自測；實際 CLI 待交付後填回。

隔離 namespace 內讓 server/browser 同處、只綁127.0.0.1；不用 host network、不與另一元件共用1420。用全新 browser context/profile、合成資料與 allowlist 環境，不繼承真 token、vault/workspace/app-data。cache 沿用共用設定，build/temp 經 shared launcher；唯一 artifacts/evidence 保留。OS network 邊界和 browser request allowlist 都要驗證。不得用真 native runtime 補 mock 缺口。

以下是既有 scripts 的**未驗證線索**，不是可直接完成 review 的 harness：

```sh
npm ci
npm run lint

npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1420 --strictPort
```

既有 src/launch-build-info.ts:12 window promise seam 必須在任何 eager import 前注入；三狀態以新 context 分開，先觀察 loading 後才 resolve/reject。

## 主要流程（第 3 輪；需先完成 DESIGN harness）

- `/`：pending→Connecting to the desktop core；resolve→Foundation ready／Version/Revision/Profile；typed reject→Build information unavailable／alert。
- 三場景各用合成短字串／長 metadata，desktop/tablet/mobile 檢查字體、窄螢幕堆疊、截斷與狀態可讀性。
- Markdown 開啟／閱讀／annotation/list 還不是此主入口可走通的旅程，保留主線缺口；不得用 mock 生造產品畫面。
- 原生 screenshot D2 已確認本 FE 切片僅 Web 層，browser 證據不取代 Mac `<1500ms` 或真 IPC gate。

## 檢查與證據

對三 viewport1440×900、834×1112、390×844 及兩種 color preference，依 PROTOCOL 全項記 pass/issue/n/a；無 blocker/major、axe critical/serious、非預期 console/pageerror/外部 request 或頁面 overflow。鍵盤/focus/長內容與 loading/error 需可核對，不能只有首頁截圖。

每次結果記 source SHA、fixture hash、browser version、已執行命令、隔離證據與未驗範圍；`runs/<timestamp>/capture.json`/REPORT 提交，PNG/storageState 不提交。未知 mock command 或未就緒 harness 必須失敗，回寫 REVIEW，不 fallback 真服務。未執行的命令／流程不可標 pass 或 targets verified。
