---
{
  "schema_version": 2,
  "id": "cooking-preparation-chain",
  "title": "備料連鎖",
  "title_en": "Staged preparation and assembly",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "planning",
    "optimization",
    "cooperation"
  ],
  "summary": "把一道菜拆成有先后关系、可并行准备的工序。",
  "note_status": "draft",
  "related": [
    "cooking-ingredient-substitution",
    "cooking-meal-loadout",
    "cooking-station-handoff",
    "automation-aerial-logistics"
  ],
  "sources": [
    {
      "title": "Staged preparation and assembly — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-preparation-chain/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把一道菜拆成有先后关系、可并行准备的工序。」
出處：`sources/text/cooking-preparation-chain.json` 字元 186-207 `summary.zh`
顯示：把一道菜拆成有先後關係、可並行準備的工序。

## 規則

「玩家把原料依次变成中间状态，再将满足条件的组件合为成品。部分步骤必须先完成，部分可以并行；交付错误状态或漏配料不能完成订单。」
出處：`sources/text/cooking-preparation-chain.json` 字元 324-386 `rules.zh`
顯示：玩家把原料依次變成中間狀態，再將滿足條件的組件合爲成品。部分步驟必須先完成，部分可以並行；交付錯誤狀態或漏配料不能完成訂單。

## 核心循環

「读配方依赖」
出處：`sources/text/cooking-preparation-chain.json` 字元 627-632 `loop[0].zh`
顯示：讀配方依賴

「并行处理原料」
出處：`sources/text/cooking-preparation-chain.json` 字元 701-707 `loop[1].zh`
顯示：並行處理原料

「完成加热或加工」
出處：`sources/text/cooking-preparation-chain.json` 字元 782-789 `loop[2].zh`
顯示：完成加熱或加工

「组装装盘」
出處：`sources/text/cooking-preparation-chain.json` 字元 861-865 `loop[3].zh`
顯示：組裝裝盤

## 玩家取捨

「提前批量切菜，还是避免台面被半成品占满？」
出處：`sources/text/cooking-preparation-chain.json` 字元 948-968 `decisions[0].zh`
顯示：提前批量切菜，還是避免檯面被半成品佔滿？

「把哪一步交给另一个人才能减少等待？」
出處：`sources/text/cooking-preparation-chain.json` 字元 1072-1089 `decisions[1].zh`
顯示：把哪一步交給另一個人才能減少等待？

## 可調參數

「依赖层数」
出處：`sources/text/cooking-preparation-chain.json` 字元 1222-1226 `parameters[0].name.zh`
顯示：依賴層數

「层数更多强化计划和记忆，但也增加新手犯错概率。」
出處：`sources/text/cooking-preparation-chain.json` 字元 1304-1327 `parameters[0].effect.zh`
顯示：層數更多強化計劃和記憶，但也增加新手犯錯概率。

「共享中间料」
出處：`sources/text/cooking-preparation-chain.json` 字元 1469-1474 `parameters[1].name.zh`
顯示：共享中間料

「多道菜共用基础料方便批处理，也制造争抢。」
出處：`sources/text/cooking-preparation-chain.json` 字元 1556-1576 `parameters[1].effect.zh`
顯示：多道菜共用基礎料方便批處理，也製造爭搶。

## 原型

「用可点击的备料格和状态标签做两道菜，先验证依赖顺序与台面容量。」
出處：`sources/text/cooking-preparation-chain.json` 字元 3033-3064 `prototype.firstStep.zh`
顯示：用可點擊的備料格和狀態標籤做兩道菜，先驗證依賴順序與檯面容量。

「玩家是否利用加热等待切菜，并在台面满时改变备料顺序？」
出處：`sources/text/cooking-preparation-chain.json` 字元 3427-3453 `prototype.test.zh`
顯示：玩家是否利用加熱等待切菜，並在檯面滿時改變備料順序？

「过多中间材料会变成物品管理负担；先确保每一步确实产生顺序或并行选择。」
出處：`sources/text/cooking-preparation-chain.json` 字元 3224-3258 `prototype.pitfall.zh`
顯示：過多中間材料會變成物品管理負擔；先確保每一步確實產生順序或並行選擇。

## 相關模式

- [食材替換](cooking-ingredient-substitution.md)
- [餐點配置組](cooking-meal-loadout.md)
- [工作站交接](cooking-station-handoff.md)
- [空中搬運物流](automation-aerial-logistics.md)

## 參考來源

- [Staged preparation and assembly — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-preparation-chain/) — 查閱：2026-11-02；取得方式：page-text。
