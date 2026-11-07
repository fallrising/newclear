---
{
  "schema_version": 2,
  "id": "inventory-shape-packing",
  "title": "形狀式背包配置",
  "title_en": "Shape-based packing",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "spatial-budget",
    "packing",
    "opportunity-cost"
  ],
  "summary": "让物品的轮廓决定能带走什么。",
  "note_status": "draft",
  "related": [
    "inventory-adjacency",
    "allocation-shop-reservation"
  ],
  "sources": [
    {
      "title": "Shape-based packing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-shape-packing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让物品的轮廓决定能带走什么。」
出處：`sources/text/inventory-shape-packing.json` 字元 173-187 `summary.zh`
顯示：讓物品的輪廓決定能帶走什麼。

## 規則

「玩家旋转、移动不同尺寸的物品，将它们塞入有限格子；物品不能重叠或越界。空隙是否能容纳下一件战利品，会直接改变保留和丢弃的选择。」
出處：`sources/text/inventory-shape-packing.json` 字元 273-336 `rules.zh`
顯示：玩家旋轉、移動不同尺寸的物品，將它們塞入有限格子；物品不能重疊或越界。空隙是否能容納下一件戰利品，會直接改變保留和丟棄的選擇。

## 核心循環

「查看新物品形状」
出處：`sources/text/inventory-shape-packing.json` 字元 542-549 `loop[0].zh`
顯示：查看新物品形狀

「旋转并重排背包」
出處：`sources/text/inventory-shape-packing.json` 字元 614-621 `loop[1].zh`
顯示：旋轉並重排揹包

「取舍无法容纳的物品」
出處：`sources/text/inventory-shape-packing.json` 字元 685-694 `loop[2].zh`
顯示：取捨無法容納的物品

「确认携带方案」
出處：`sources/text/inventory-shape-packing.json` 字元 761-767 `loop[3].zh`
顯示：確認攜帶方案

## 玩家取捨

「先放大件还是先保留关键物品？几何最优不一定是战术最优。」
出處：`sources/text/inventory-shape-packing.json` 字元 850-877 `decisions[0].zh`
顯示：先放大件還是先保留關鍵物品？幾何最優不一定是戰術最優。

「为未来留空位，还是立刻把收益装满？」
出處：`sources/text/inventory-shape-packing.json` 字元 1025-1042 `decisions[1].zh`
顯示：爲未來留空位，還是立刻把收益裝滿？

## 可調參數

「背包形状」
出處：`sources/text/inventory-shape-packing.json` 字元 1185-1189 `parameters[0].name.zh`
顯示：揹包形狀

「凹凸边界增加局部难题；规则矩形更容易比较方案。」
出處：`sources/text/inventory-shape-packing.json` 字元 1260-1283 `parameters[0].effect.zh`
顯示：凹凸邊界增加局部難題；規則矩形更容易比較方案。

「物品旋转」
出處：`sources/text/inventory-shape-packing.json` 字元 1445-1449 `parameters[1].name.zh`
顯示：物品旋轉

「允许旋转降低卡死概率，禁止旋转会强化提前规划。」
出處：`sources/text/inventory-shape-packing.json` 字元 1519-1542 `parameters[1].effect.zh`
顯示：允許旋轉降低卡死概率，禁止旋轉會強化提前規劃。

## 原型

「用一个小格子背包和五种固定形状物品，实现拖动、旋转与冲突提示。」
出處：`sources/text/inventory-shape-packing.json` 字元 2954-2985 `prototype.firstStep.zh`
顯示：用一個小格子揹包和五種固定形狀物品，實現拖動、旋轉與衝突提示。

「观察玩家是否为了保留重要物品主动重排，而非每次直接丢掉最大件。」
出處：`sources/text/inventory-shape-packing.json` 字元 3289-3320 `prototype.test.zh`
顯示：觀察玩家是否爲了保留重要物品主動重排，而非每次直接丟掉最大件。

「先别加装备属性；最基本的拾取、旋转和放回必须顺手。」
出處：`sources/text/inventory-shape-packing.json` 字元 3124-3149 `prototype.pitfall.zh`
顯示：先別加裝備屬性；最基本的拾取、旋轉和放回必須順手。

## 相關模式

- [相鄰關係驅動的組合加成](inventory-adjacency.md)
- [商店保留與選項成本](allocation-shop-reservation.md)

## 參考來源

- [Shape-based packing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-shape-packing/) — 查閱：2026-11-02；取得方式：page-text。
