# FE Review — cms-scaffold — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認（假設：D1 採 (a)）。
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

- 無。

## 需要放開或決定的點

### D1 放開 `packages/ui` 的修改權限

- 選項：(a) 允許第 2 輪直接修改 `packages/ui`，條件是三個 app 的測試都通過；(b) 維持先提議。
- 建議：(a)。共用套件是這個專案的設計重點，逐次提議只會拖慢；以三個 app 的 `lint`／`typecheck`／`test`／`build` 與 `test:bundle` 作為護欄。依 C2，實際修改排在 v2 前端波次完成之後。
- 狀態：**待擁有者決定**。`DESIGN.md` 以 (a) 作為假設，在設計 PR 中由擁有者確認。

### D2 `vite.config.ts` 的 `server.host` 是否改成只綁 loopback

- 選項：(a) 把三個 app 的 `server.host` 改為預設（只綁 loopback），需要區網連線時再手動加 `--host`；(b) 維持 `host: true`，fe-review 以啟動指令覆寫。
- 建議：(b)，至少到 v2 W5 為止。C3 不妨礙擷取，而 `vite.config.ts` 在 v2 多個波次的修改範圍內（C2）；若要改，併入 W5 硬化或 v2 完成後的第 2 輪 PR。
- 狀態：**待擁有者決定**。`DESIGN.md` 不處理，列在「開放問題」。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新（設計 PR 內已完成）。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
