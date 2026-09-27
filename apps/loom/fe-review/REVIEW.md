# FE Review — loom — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：README 規定恢復投入需要擁有者在 `PORTFOLIO.md` 做出決定。第 2 輪修改前必須先決定 R1（見下）。

## 矛盾點

### C1 前端直接依賴 Tauri IPC

`src/ipc.ts` 依賴 Tauri；terminal 與檔案系統畫面在瀏覽器中無法運作。

## 需要放開或決定的點

### R1 休眠元件是否允許第 2 輪修改

- 選項：(a) 在 `PORTFOLIO.md` 恢復投入後修改；(b) 維持休眠，只允許不改行為的 a11y／破版修正；(c) 只做第 3 輪檢查、不修改。
- 建議：(b)，並把這個例外寫進 `PORTFOLIO.md` 或 `docs/portfolio-doc-tiers.md`，避免每個元件各自解釋。
- 狀態：**待擁有者決定**

### D1 IPC 解耦方式

- 同 flowshot：(a) IPC adapter；(b) `addInitScript` mock。
- 建議：(b) 先行。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
