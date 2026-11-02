---
{
  "schema_version": 1,
  "id": "fishing-bite-window",
  "title": "訊號辨識與反應窗口",
  "title_en": "Bite timing",
  "category": "fishing",
  "tags": [
    "signal-reading",
    "timing",
    "risk-reward"
  ],
  "summary": "用可辨識訊號與有限操作窗口，把等待變成觀察和判斷。",
  "related": [
    "combat-stamina-budget"
  ],
  "sources": [
    {
      "title": "Bite timing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-bite-window/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站以魚訊為例：拋竿後辨識真正的咬鉤，在窗口內收竿；太早與太晚都可能失敗。核心循環：開始等待 → 辨識訊號 → 決定出手時機 → 取得結果再嘗試。

## 問題與情境（本地分析）

適用於需要短時注意力而非長指令序列的互動。設計問題是如何讓成功來自讀懂回饋，而不只是背誦固定倒數。

## 解法與取捨（本地分析）

- 等待長度可變，但有效訊號必須一致；用視覺與聲音的冗餘提示降低單一感官門檻。
- 失敗結果要區分「過早」與「過晚」，讓玩家知道該修正哪個決策。

## 可調參數（本地分析）

- 等待時間分布、假訊號數量、反應窗口長度、失敗後的重試成本。
- 無障礙模式可放寬窗口，保持辨識問題而降低純反射門檻。

## 失敗模式（本地分析）

- 真假訊號沒有可辨差異，會讓學習失去意義。
- 輸入延遲或動畫時間與判定窗口不一致，會造成不公平感。

## 最小原型與驗收（本地提案）

- 本地提案：一個按鈕、兩種訊號、可調判定窗口；先不做魚種與裝備。
- 驗收：Given 已出現有效訊號，When 在窗口內按鍵，Then 成功；邊界外需給出可區別的提前或逾時原因。

## 相關模式

- [攻守共用資源預算](combat-stamina-budget.md)

## 參考來源

- [Bite timing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-bite-window/) — 查閱：2026-11-02；取得方式：page-text。
