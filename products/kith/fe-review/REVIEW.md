# FE Review — kith — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可依元件 `AGENTS.md` 與 PROTOCOL 第 4 節直接修改前端。

## 矛盾點

### C1 前端需要本機 worker 與 D1 才有資料

`web/` 的 `/api`、`/mcp` 代理到 wrangler worker；沒有獨立的 mock 模式，UI 無法脫離後端擷取。依 PROTOCOL 第 0 節屬測試耦合。

### C2 LLM provider 功能沒有已知的假實作

agent 回覆、串流等畫面需要 provider；目前未確認 repo 內是否有 fake provider。沒有的話，第 3 輪無法在合成資料下覆蓋主要流程。

## 需要放開或決定的點

### D1 前端 mock 的位置

- 選項：(a) 前端加 contract mock（MSW 類）；(b) 沿用 `e2e/` harness 啟動真實 worker＋本機 D1。
- 建議：(b) 先行、(a) 視第 3 輪成本再決定：harness 已存在，改動最小。
- 狀態：**待擁有者決定**

### D2 fake LLM provider

- 選項：(a) 在 worker 端新增只供測試的 fake provider；(b) 在 e2e harness 攔截 provider 呼叫。
- 建議：待確認現有 harness 能力後再選；新增 provider 屬後端變更，需擁有者決定。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
