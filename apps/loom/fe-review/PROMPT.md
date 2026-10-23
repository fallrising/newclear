# FE Review Prompt — loom

先讀 [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)、[REVIEW](REVIEW.md)、[DESIGN](DESIGN.md) 與 [SUCCESS](../SUCCESS.md)。本工作包是 **第 1 輪 draft，待 owner D1 與 AC-15 確認**；不啟動、不修改程式碼、不跑 capture。

## 專案與目前入口

- `apps/loom`；React18/Vite5/Tauri2，Node20+。Loom 維持 dormant，不重啟產品 backlog。
- 目前 App 是 canvas +terminal/+document、document/terminal nodes 與 history。src/ipc.ts 之外還有 doc/AI/canvas/window-close native 邊界，見 DESIGN M1。
- 唯一頁面 `/`，Vite loopback1420。terminal/doc/content/history 狀態靠 IPC/events，首頁出現不代表全流程已接通。

## 啟動先備（提案，全部未執行）

目前 **未 capture-ready**。`targets.json` 只描述 dev server 與 `/`，`verified: false`；它不會裝 IPC mock。共用 capture.mjs 沒有 addInitScript hook，不能單獨執行就聲稱完成下列流程。DESIGN 的本元件 review fixture/driver 仍須第 2 輪實作與自測；實際 CLI 待交付後填回。

隔離 namespace 內讓 server/browser 同處、只綁127.0.0.1；不用 host network、不與另一元件共用1420。用全新 browser context/profile、合成資料與 allowlist 環境，不繼承真 token、vault/workspace/app-data。cache/build/temp 經 shared launcher；唯一 artifacts/evidence 保留。OS network 邊界和 browser request allowlist 都要驗證。不得用真 native runtime 補 mock 缺口。

以下是既有 scripts 的**未驗證線索**，不是可直接完成 review 的 harness：

```sh
npm ci
npm run typecheck:contracts
npm run typecheck:app
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1420 --strictPort
```

mock 須含 command/event/callback 註冊、unlisten/reset 與狀態變化，未知命令拒絕；native DTO/Origin/close guards 不得為截圖放寬。

## 主要流程（第 3 輪；需先完成 DESIGN harness）

- `/` 空 canvas→+terminal→+document/open notes.md→縮放、節點選取、畫線與 focus。
- 合成 document 編輯→Cancel/Discard/Save/error/conflict；dirty Cancel/失敗 Save 不關閉或刪 incident edges。
- history loading/empty/error/in-memory warning→明確 Restart/Forget；初載入不重跑命令，關閉/disposal 釋放 listeners。
- 已有 Run/Pin 只走 fake stdin/output；畫 feeds_output_to 不應被誤報為驅動 Run/Pin。AI預設無key；任何 stream/cancel 都只能是明確synthetic fixture。
- 真 PTY/filesystem/SQLite/watcher/provider/原生視窗與跨平台不在 browser mock 驗收內。

## 檢查與證據

對三 viewport1440×900、834×1112、390×844 及兩種 color preference，依 PROTOCOL 全項記 pass/issue/n/a；無 blocker/major、axe critical/serious、非預期 console/pageerror/外部 request 或頁面 overflow。鍵盤/focus/長內容與 loading/error 需可核對，不能只有首頁截圖。

每次結果記 source SHA、fixture hash、browser version、已執行命令、隔離證據與未驗範圍；`runs/<timestamp>/capture.json`/REPORT 提交，PNG/storageState 不提交。未知 mock command 或未就緒 harness 必須失敗，回寫 REVIEW，不 fallback 真服務。未執行的命令／流程不可標 pass 或 targets verified。
