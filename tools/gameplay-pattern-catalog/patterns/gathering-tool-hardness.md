---
{
  "schema_version": 2,
  "id": "gathering-tool-hardness",
  "title": "工具能力門檻",
  "title_en": "Harvesting tool gates",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "capability-gate",
    "progression",
    "backtracking"
  ],
  "summary": "先展示可見但暫不可取的資源，讓工具升級改變可行動範圍。",
  "note_status": "draft",
  "related": [
    "exploration-ability-gates",
    "cooking-recipe-learning"
  ],
  "sources": [
    {
      "title": "Harvesting tool gates — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-tool-hardness/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述資源需要特定工具種類或等級，玩家取得升級後返回採集。核心循環：看見資源 → 理解工具要求 → 升級或更換工具 → 返回取得新材料。
本摘要依來源頁面文字整理。

## 問題與情境（本地分析）

適用於需要引導製作順序與探索節奏的資源系統。門檻應表達新的可行動能力，而不只是延長採集時間。

## 核心循環（本地分析）

- 玩家行動：看見一處資源，嘗試採集後得知它需要的工具種類或等級高於手上的裝備。
- 系統回饋：介面標示出差了哪一級或哪種工具，玩家能把「升級或更換工具」與「這處資源」連起來，而不只是看到採集失敗。
- 下一個決策：決定是否投入材料升級工具、更換成合適工具後再回來取得新材料，或先轉去採其他已能處理的資源。

## 解法與取捨（本地分析）

- 把完全無法採集與效率較低分開顯示；互動前就告知所需能力。
- 以能力旗標判斷可否採集，避免把所有規則綁死在某一把特定道具。

## 可調參數（本地分析）

- 工具種類、能力階段、升級成本、資源點的地圖標記。
- 是否允許替代路徑，例如交易或消耗性工具；必須明示其代價。

## 失敗模式（本地分析）

- 要求採到新礦才能升級，但新礦又要求該升級，會形成無解循環。
- 失敗採集沒有原因提示，玩家可能誤認為場景裝飾。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。這裡只說明要觀察的差異，不另設來源沒有寫出的數量。

- 最小範圍：做一個小場景，讓玩家依序經歷「看見資源」、「理解工具要求」、「升級或更換工具」、「返回取得新材料」。只保留能分辨這些狀態的回饋，不加入來源沒有寫出的計數、時間或門檻。
- 驗收：玩家走完這個順序時，回饋要指出目前落在哪一步，以及下一步因此有什麼不同。若兩種做法看起來一樣，就不算通過。
- 邊界驗收：玩家跳過其中一步，或讓兩種做法得到同一種回饋時，結果必須與走完順序不同。若這時仍然看不出差異，這個原型就還沒測到取捨。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)：工具升級與能力解鎖都讓舊地點從「看得到」變成「進得去」。
- [知識與材料雙重解鎖](cooking-recipe-learning.md)：新材料常是新配方的另一半條件；先有工具還是先有知識，會改變玩家先追哪一條線。

## 參考來源

- [Harvesting tool gates — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-tool-hardness/) — 查閱：2026-11-02；取得方式：page-text。
