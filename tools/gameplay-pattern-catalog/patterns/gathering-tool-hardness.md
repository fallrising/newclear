---
{
  "schema_version": 1,
  "id": "gathering-tool-hardness",
  "title": "工具能力門檻",
  "title_en": "Harvesting tool gates",
  "category": "gathering",
  "tags": [
    "capability-gate",
    "progression",
    "backtracking"
  ],
  "summary": "先展示可見但暫不可取的資源，讓工具升級改變可行動範圍。",
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

原站描述資源需要特定工具種類或等級，玩家取得升級後返回採集。核心循環：看見資源 → 理解工具要求 → 選擇升級 → 返回取得新材料。

## 問題與情境（本地分析）

適用於需要引導製作順序與探索節奏的資源系統。門檻應表達新的可行動能力，而不只是延長採集時間。

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

- 本地提案：兩級工具、三種資源點、一條無循環的升級依賴。
- 驗收：Given 初階工具與高階資源，When 嘗試採集，Then 顯示能力缺口且不扣材料；升級後同一地點可成功採集。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)
- [知識與材料雙重解鎖](cooking-recipe-learning.md)

## 參考來源

- [Harvesting tool gates — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-tool-hardness/) — 查閱：2026-11-02；取得方式：page-text。
