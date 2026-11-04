---
{
  "schema_version": 2,
  "id": "inventory-stack-limits",
  "title": "堆疊限制",
  "title_en": "Slots and stack limits",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "planning",
    "optimization",
    "economy"
  ],
  "summary": "同类可以合并，物品种类却仍然占用空间。",
  "note_status": "draft",
  "related": [
    "inventory-adjacency",
    "inventory-death-retrieval",
    "inventory-deck-thinning",
    "inventory-equipment-budget"
  ],
  "sources": [
    {
      "title": "Slots and stack limits — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-stack-limits/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同类可以合并，物品种类却仍然占用空间。」
出處：`sources/text/inventory-stack-limits.json` 字元 176-195 `summary.zh`
顯示：同類可以合併，物品種類卻仍然佔用空間。

## 規則

「物品占用有限栏位，同类物品在上限内堆叠；不同类型或品质往往需要分开。玩家决定保留多种少量样品还是少种大量原料，并通过箱子腾出携带栏位。」
出處：`sources/text/inventory-stack-limits.json` 字元 289-356 `rules.zh`
顯示：物品佔用有限欄位，同類物品在上限內堆疊；不同類型或品質往往需要分開。玩家決定保留多種少量樣品還是少種大量原料，並通過箱子騰出攜帶欄位。

## 核心循環

「合并兼容物品」
出處：`sources/text/inventory-stack-limits.json` 字元 606-612 `loop[0].zh`
顯示：合併兼容物品

「查看剩余栏位」
出處：`sources/text/inventory-stack-limits.json` 字元 678-684 `loop[1].zh`
顯示：查看剩餘欄位

「保留样品或大宗材料」
出處：`sources/text/inventory-stack-limits.json` 字元 744-753 `loop[2].zh`
顯示：保留樣品或大宗材料

「入库释放空间」
出處：`sources/text/inventory-stack-limits.json` 字元 823-829 `loop[3].zh`
顯示：入庫釋放空間

## 玩家取捨

「最后一格要留给未知掉落，还是带备用工具？」
出處：`sources/text/inventory-stack-limits.json` 字元 919-939 `decisions[0].zh`
顯示：最後一格要留給未知掉落，還是帶備用工具？

「保留多种各一份的材料，还是只带少数几种并把它们堆满？」
出處：`sources/text/inventory-stack-limits.json` 字元 1046-1072 `decisions[1].zh`
顯示：保留多種各一份的材料，還是隻帶少數幾種並把它們堆滿？

## 可調參數

「堆叠上限」
出處：`sources/text/inventory-stack-limits.json` 字元 1226-1230 `parameters[0].name.zh`
顯示：堆疊上限

「高上限利于批量生产；低上限让采集路线更短。」
出處：`sources/text/inventory-stack-limits.json` 字元 1301-1322 `parameters[0].effect.zh`
顯示：高上限利於批量生產；低上限讓採集路線更短。

「品质能否合并」
出處：`sources/text/inventory-stack-limits.json` 字元 1463-1469 `parameters[1].name.zh`
顯示：品質能否合併

「不同品质分栏增加整理压力，也让高品质更醒目。」
出處：`sources/text/inventory-stack-limits.json` 字元 1552-1574 `parameters[1].effect.zh`
顯示：不同品質分欄增加整理壓力，也讓高品質更醒目。

## 原型

「做六格背包、三种材料和一个堆叠上限，允许拆分与合并。」
出處：`sources/text/inventory-stack-limits.json` 字元 3109-3135 `prototype.firstStep.zh`
顯示：做六格揹包、三種材料和一個堆疊上限，允許拆分與合併。

「观察玩家能否预测一次拾取会占几格，并据此规划回程。」
出處：`sources/text/inventory-stack-limits.json` 字元 3436-3461 `prototype.test.zh`
顯示：觀察玩家能否預測一次拾取會佔幾格，並據此規劃回程。

「品质、绑定状态等都能拆出额外种类；初版保持类型差异清楚。」
出處：`sources/text/inventory-stack-limits.json` 字元 3272-3300 `prototype.pitfall.zh`
顯示：品質、綁定狀態等都能拆出額外種類；初版保持類型差異清楚。

## 相關模式

- [相鄰關係驅動的組合加成](inventory-adjacency.md)
- [死亡取回](inventory-death-retrieval.md)
- [牌組抽疏](inventory-deck-thinning.md)
- [裝備預算](inventory-equipment-budget.md)

## 參考來源

- [Slots and stack limits — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-stack-limits/) — 查閱：2026-11-02；取得方式：page-text。
