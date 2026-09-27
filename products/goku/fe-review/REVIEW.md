# FE Review — goku — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：README 規定恢復投入需要擁有者在 `PORTFOLIO.md` 做出決定。第 2 輪修改前必須先決定 R1（見下）。

## 矛盾點

### C1 `web/.env` 被 Git 追蹤

public repository 中追蹤了 `.env`。內容應只有 API URL，但這與「不提交環境檔」的一般慣例衝突；本次未輸出其值。

### C2 技術棧落後其他元件

React 18、Vite 5、Tailwind 3；PROTOCOL 禁止未經提議升級 major 版本。

## 需要放開或決定的點

### R1 休眠元件是否允許第 2 輪修改

- 選項：(a) 在 `PORTFOLIO.md` 恢復投入後修改；(b) 維持休眠，只允許不改行為的 a11y／破版修正；(c) 只做第 3 輪檢查、不修改。
- 建議：(b)，並把這個例外寫進 `PORTFOLIO.md` 或 `docs/portfolio-doc-tiers.md`，避免每個元件各自解釋。
- 狀態：**待擁有者決定**

### D2 `web/.env` 的處理

- 選項：(a) 改為 `.env.example` 並移出追蹤；(b) 確認無敏感值後維持。
- 建議：(a)，並在 PR 中確認內容無敏感值。
- 狀態：**待擁有者決定**

### D3 是否升級技術棧

- 屬 major 升級，只在 R1 選擇恢復投入時才有意義。
- 建議：建議不升級，除非 R1 為 (a)。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
