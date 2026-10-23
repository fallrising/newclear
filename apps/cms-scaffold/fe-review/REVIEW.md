# FE Review — cms-scaffold — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採 (b)：packages/ui 維持先提議，不授權直接修改；D2 採 (b)：loopback 啟動覆寫，不改共用 Vite 設定。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始；排在 v2 前端波次全部 `VERIFIED` 之後）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。v2 前端波次未完成前，前端原始碼的修改由 v2 施工圖負責（見 C2）。

## 矛盾點

### C1 共用 `packages/ui` 的修正會同時影響三個 app

PROTOCOL 第 4 節把共用套件列為「先提議」，但多數視覺一致性問題的根因會在共用套件；v2 也把 tokens 與元件集中在 `packages/ui`（`docs/v2/01-frontend-sdd.md` §4.2）。

### C2 v2 施工圖以行號 diff 修改前端，fe-review 不能先改同一批檔案

v2 的 W2、W3、W4 施工圖以前一波的結果為起點，`修改` 類檔案用帶行號的 diff 套用（各施工圖開頭的說明）；W2～W5 也都修改 `apps/*/vite.config.ts`。波次實作前由 fe-review 修改 `apps/*/src/`、`packages/*` 或 `vite.config.ts`，會讓後續施工圖套用失敗。結論已寫進 `DESIGN.md`「不做的事」：v2 前端波次全部 `VERIFIED` 前，fe-review 只改自己的 `fe-review/`。

### C3 `vite.config.ts` 預設綁定所有介面

三個 app 的 `server.host` 與 `preview.host` 都是 `true`（`apps/web-front/vite.config.ts:10-11`，`web-back`、`web-admin` 同位置），不加參數啟動時會綁 `0.0.0.0`，與 PROTOCOL 第 0 節「服務綁 `127.0.0.1`」不一致。不構成耦合：CLI 的 `--host 127.0.0.1` 會覆寫設定，`targets.json` 的啟動指令已經帶上。`preview` 的 `host` 由 Docker 映像自己傳 `--host 0.0.0.0`（`docker/web.Dockerfile:17`），不依賴設定檔。

## 已決定

- 本次選定方案已獲 owner 明確確認，見頁首與下方決定。

## 本次確認的決定

### D1 放開 `packages/ui` 的修改權限

- 選項：(a) 允許第 2 輪直接修改 `packages/ui`，條件是三個 app 的測試都通過；(b) 維持先提議。
- 決定：採 (b)，維持先提議；目前設計不需要修改 `packages/ui`。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

### D2 `vite.config.ts` 的 `server.host` 是否改成只綁 loopback

- 選項：(a) 把三個 app 的 `server.host` 改為預設（只綁 loopback），需要區網連線時再手動加 `--host`；(b) 維持 `host: true`，fe-review 以啟動指令覆寫。
- 建議：(b)，至少到 v2 W5 為止。C3 不妨礙擷取，而 `vite.config.ts` 在 v2 多個波次的修改範圍內（C2）；若要改，併入 W5 硬化或 v2 完成後的第 2 輪 PR。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新（設計 PR 內已完成）。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- fallrising/newclear#179：第 1 輪 `DESIGN.md`（已確認設計方向）。
