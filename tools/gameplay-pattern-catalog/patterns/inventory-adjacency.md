---
{
  "schema_version": 2,
  "id": "inventory-adjacency",
  "title": "相鄰關係驅動的組合加成",
  "title_en": "Item adjacency bonuses",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "spatial-synergy",
    "dependency-graph",
    "composition"
  ],
  "summary": "同一件道具，换个邻居就能改变价值。",
  "note_status": "draft",
  "related": [
    "inventory-shape-packing",
    "automation-belt-routing"
  ],
  "sources": [
    {
      "title": "Item adjacency bonuses — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-adjacency/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一件道具，换个邻居就能改变价值。」
出處：`sources/text/inventory-adjacency.json` 字元 172-189 `summary.zh`
顯示：同一件道具，換個鄰居就能改變價值。

## 規則

「物品除了占格，还根据邻接、方向或周边类别触发加成。玩家在有限空间内搭出有效连接，战斗结果再反馈布局强弱；这里只讨论物品之间的空间关系。」
出處：`sources/text/inventory-adjacency.json` 字元 277-344 `rules.zh`
顯示：物品除了佔格，還根據鄰接、方向或周邊類別觸發加成。玩家在有限空間內搭出有效連接，戰鬥結果再反饋佈局強弱；這裏只討論物品之間的空間關係。

## 核心循環

「读出物品作用范围」
出處：`sources/text/inventory-adjacency.json` 字元 561-569 `loop[0].zh`
顯示：讀出物品作用範圍

「摆放目标邻居」
出處：`sources/text/inventory-adjacency.json` 字元 638-644 `loop[1].zh`
顯示：擺放目標鄰居

「检验加成连接」
出處：`sources/text/inventory-adjacency.json` 字元 714-720 `loop[2].zh`
顯示：檢驗加成連接

「根据结果调整布局」
出處：`sources/text/inventory-adjacency.json` 字元 788-796 `loop[3].zh`
顯示：根據結果調整佈局

## 玩家取捨

「把核心道具围满，还是让多个次级引擎分散运作？」
出處：`sources/text/inventory-adjacency.json` 字元 884-906 `decisions[0].zh`
顯示：把核心道具圍滿，還是讓多個次級引擎分散運作？

「更强单件若破坏已有连接，是否还值得换入？」
出處：`sources/text/inventory-adjacency.json` 字元 1008-1028 `decisions[1].zh`
顯示：更強單件若破壞已有連接，是否還值得換入？

## 可調參數

「作用方向」
出處：`sources/text/inventory-adjacency.json` 字元 1167-1171 `parameters[0].name.zh`

「仅某一侧生效会增加朝向解题；全邻接更自由。」
出處：`sources/text/inventory-adjacency.json` 字元 1249-1270 `parameters[0].effect.zh`
顯示：僅某一側生效會增加朝向解題；全鄰接更自由。

「加成叠加」
出處：`sources/text/inventory-adjacency.json` 字元 1421-1425 `parameters[1].name.zh`
顯示：加成疊加

「可叠加会形成集中投资；上限则鼓励分散布局。」
出處：`sources/text/inventory-adjacency.json` 字元 1495-1516 `parameters[1].effect.zh`
顯示：可疊加會形成集中投資；上限則鼓勵分散佈局。

## 原型

「做六种物品和两种邻接规则，用连线即时显示哪些效果正在生效。」
出處：`sources/text/inventory-adjacency.json` 字元 2917-2946 `prototype.firstStep.zh`
顯示：做六種物品和兩種鄰接規則，用連線即時顯示哪些效果正在生效。

「让玩家在放置前预测加成，检查实际结果是否符合其理解。」
出處：`sources/text/inventory-adjacency.json` 字元 3249-3275 `prototype.test.zh`
顯示：讓玩家在放置前預測加成，檢查實際結果是否符合其理解。

「先限制效果触发顺序；相邻、斜角、方向和连锁同时加入容易解释不清。」
出處：`sources/text/inventory-adjacency.json` 字元 3075-3107 `prototype.pitfall.zh`
顯示：先限制效果觸發順序；相鄰、斜角、方向和連鎖同時加入容易解釋不清。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)
- [受限空間中的物流路由](automation-belt-routing.md)

## 參考來源

- [Item adjacency bonuses — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-adjacency/) — 查閱：2026-11-02；取得方式：page-text。
