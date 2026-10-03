# FE Review — DESIGN.md 模板

每個元件的 `<component>/fe-review/DESIGN.md` 依這個結構撰寫。規則見 [PROTOCOL.md](PROTOCOL.md) 的「`DESIGN.md` 規則」；撰寫流程見 [DESIGN-PROMPT.md](DESIGN-PROMPT.md)。

以下 `<...>` 是填寫說明，完成後刪除。

```markdown
# FE Review — <元件名稱> — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿／已確認**。每次修改都走 PR。

## 目標

<一段話：第 2 輪結束時，這個 UI 要達到什麼狀態。例如「能在隔離容器內以合成資料單獨啟動，主要流程可截圖，a11y 無 critical／serious」。>

## 依據

- REVIEW.md 已決定：<列出 D 編號與一句結論>
- 假設（待擁有者在本 PR 確認）：<REVIEW.md 中仍待決定、本設計先採用建議的項目；沒有就寫「無」>
- 相關規範：<元件 AGENTS.md、ADR、SDD 中會約束本設計的條款>

## 不做的事

<明確列出本輪不做的範圍，例如 major 依賴升級、新功能、後端 API 變更。>

## 修改項目

### M1 <標題>
- 對應：<REVIEW.md 的 C／D 編號>
- 現況：<file:line 與問題>
- 修改：<要改什麼，改到哪些檔案或模組>
- 驗證：<元件自己的哪些 lint／typecheck／test／build 要跑；需要新增哪些測試>
- 風險與回滾：<可能的副作用；如何回退>

<依需要增加 M2、M3…；每一項應能對應到一個 commit 或一個小 PR。>

## 啟動方式（第 2 輪要驗證的版本）

<在 PROTOCOL 第 0 節隔離環境中的啟動指令、需要的合成資料、port；第 2 輪驗證後同步到 targets.json。>

## 第 3 輪驗收

- 頁面與流程：<targets.json 的頁面清單，以及 PROMPT.md 的主要流程>
- 通過條件：<例如無 blocker／major；axe 無 critical／serious；三種 viewport 無水平溢出>
- 已知不在驗收範圍：<例如原生視窗、需要真實雲端的畫面>

## 開放問題

<仍需擁有者或後續設計回答的問題；沒有就寫「無」。>
```
