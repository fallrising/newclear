---
{
  "schema_version": 2,
  "id": "inventory-equipment-budget",
  "title": "裝備預算",
  "title_en": "Budgeted ability loadouts",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "planning",
    "optimization",
    "progression"
  ],
  "summary": "拥有所有能力，也不等于能同时装备。",
  "note_status": "draft",
  "related": [
    "inventory-adjacency",
    "inventory-deck-thinning",
    "inventory-shape-packing",
    "inventory-stack-limits"
  ],
  "sources": [
    {
      "title": "Budgeted ability loadouts — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-equipment-budget/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「拥有所有能力，也不等于能同时装备。」
出處：`sources/text/inventory-equipment-budget.json` 字元 185-202 `summary.zh`
顯示：擁有所有能力，也不等於能同時裝備。

## 規則

「每个能力占用一定容量，玩家在固定预算下搭配少数强能力或多个小能力。更换通常发生在安全节点，出发后用实际表现检验组合，再回到节点调整。」
出處：`sources/text/inventory-equipment-budget.json` 字元 301-367 `rules.zh`
顯示：每個能力佔用一定容量，玩家在固定預算下搭配少數強能力或多個小能力。更換通常發生在安全節點，出發後用實際表現檢驗組合，再回到節點調整。

## 核心循環

「查看可用容量」
出處：`sources/text/inventory-equipment-budget.json` 字元 609-615 `loop[0].zh`

「选定核心能力」
出處：`sources/text/inventory-equipment-budget.json` 字元 683-689 `loop[1].zh`
顯示：選定核心能力

「补齐协同与短板」
出處：`sources/text/inventory-equipment-budget.json` 字元 754-761 `loop[2].zh`
顯示：補齊協同與短板

「实战后回站重配」
出處：`sources/text/inventory-equipment-budget.json` 字元 829-836 `loop[3].zh`
顯示：實戰後回站重配

## 玩家取捨

「纯输出最大化，还是牺牲一部分效率换生存或便利？」
出處：`sources/text/inventory-equipment-budget.json` 字元 929-952 `decisions[0].zh`
顯示：純輸出最大化，還是犧牲一部分效率換生存或便利？

「带一个高容量的强能力，还是带几种小能力应对更多情况？」
出處：`sources/text/inventory-equipment-budget.json` 字元 1066-1092 `decisions[1].zh`
顯示：帶一個高容量的強能力，還是帶幾種小能力應對更多情況？

## 可調參數

「容量成长」
出處：`sources/text/inventory-equipment-budget.json` 字元 1259-1263 `parameters[0].name.zh`
顯示：容量成長

「逐步加容量给予组合成长；固定容量强调持续取舍。」
出處：`sources/text/inventory-equipment-budget.json` 字元 1340-1363 `parameters[0].effect.zh`
顯示：逐步加容量給予組合成長；固定容量強調持續取捨。

「重配位置」
出處：`sources/text/inventory-equipment-budget.json` 字元 1510-1514 `parameters[1].name.zh`

「随时更换鼓励逐题应对；仅安全点更换要求预判。」
出處：`sources/text/inventory-equipment-budget.json` 字元 1591-1613 `parameters[1].effect.zh`
顯示：隨時更換鼓勵逐題應對；僅安全點更換要求預判。

## 原型

「做五种有明确用途的能力和一个容量上限，用两种不同任务验证搭配。」
出處：`sources/text/inventory-equipment-budget.json` 字元 3077-3108 `prototype.firstStep.zh`
顯示：做五種有明確用途的能力和一個容量上限，用兩種不同任務驗證搭配。

「切换任务后，观察玩家是否主动换装，并能说明牺牲了什么。」
出處：`sources/text/inventory-equipment-budget.json` 字元 3432-3459 `prototype.test.zh`
顯示：切換任務後，觀察玩家是否主動換裝，並能說明犧牲了什麼。

「先避免几十个百分比加成；用途有区别才能让容量取舍容易理解。」
出處：`sources/text/inventory-equipment-budget.json` 字元 3260-3289 `prototype.pitfall.zh`
顯示：先避免幾十個百分比加成；用途有區別才能讓容量取捨容易理解。

## 相關模式

- [相鄰關係驅動的組合加成](inventory-adjacency.md)
- [牌組抽疏](inventory-deck-thinning.md)
- [形狀式背包配置](inventory-shape-packing.md)
- [堆疊限制](inventory-stack-limits.md)

## 參考來源

- [Budgeted ability loadouts — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-equipment-budget/) — 查閱：2026-11-02；取得方式：page-text。
