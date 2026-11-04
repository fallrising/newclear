---
{
  "schema_version": 2,
  "id": "farming-fertilizer-tradeoff",
  "title": "肥料取捨",
  "title_en": "Fertilizer investment",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "economy",
    "optimization"
  ],
  "summary": "先投入稀缺材料，换取更快或更优的收成。",
  "note_status": "draft",
  "related": [
    "commerce-dynamic-market",
    "commerce-trade-route-programming",
    "farming-irrigation-layout",
    "farming-livestock-care"
  ],
  "sources": [
    {
      "title": "Fertilizer investment — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-fertilizer-tradeoff/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先投入稀缺材料，换取更快或更优的收成。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 177-196 `summary.zh`
顯示：先投入稀缺材料，換取更快或更優的收成。

## 規則

「玩家在播种前后按规则给地块施肥，用材料成本换取成长或品质收益。不同肥效不一定可叠加，土地闲置和换季也可能影响保留，反馈来自实际收获时间与产物。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 312-383 `rules.zh`
顯示：玩家在播種前後按規則給地塊施肥，用材料成本換取成長或品質收益。不同肥效不一定可疊加，土地閒置和換季也可能影響保留，反饋來自實際收穫時間與產物。

## 核心循環

「选择收成目标」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 662-668 `loop[0].zh`
顯示：選擇收成目標

「制作或购买肥料」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 738-745 `loop[1].zh`
顯示：製作或購買肥料

「施肥并种植」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 812-817 `loop[2].zh`
顯示：施肥並種植

「核对增益是否抵过成本」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 876-886 `loop[3].zh`
顯示：覈對增益是否抵過成本

## 玩家取捨

「追求高品质售价，还是提前收获再种一轮，取决于剩余时间。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 984-1011 `decisions[0].zh`
顯示：追求高品質售價，還是提前收穫再種一輪，取決於剩餘時間。

「贵作物更容易覆盖肥料成本，但也把更多价值押在一块田上。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 1134-1161 `decisions[1].zh`
顯示：貴作物更容易覆蓋肥料成本，但也把更多價值押在一塊田上。

## 可調參數

「增益方向」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 1330-1334 `parameters[0].name.zh`

「提速改变日程，提质改变出售或加工选择。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 1408-1427 `parameters[0].effect.zh`
顯示：提速改變日程，提質改變出售或加工選擇。

「保留规则」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 1569-1573 `parameters[1].name.zh`
顯示：保留規則

「长期保留鼓励固定田块，易失效则要求持续投入。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 1646-1668 `parameters[1].effect.zh`
顯示：長期保留鼓勵固定田塊，易失效則要求持續投入。

## 原型

「先做一种作物、两种互斥肥料，结算时列出投入、收获次数和净收益。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 3134-3165 `prototype.firstStep.zh`
顯示：先做一種作物、兩種互斥肥料，結算時列出投入、收穫次數和淨收益。

「用季初和季末两个场景，检查玩家选择是否改变，并能解释原因。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 3489-3518 `prototype.test.zh`
顯示：用季初和季末兩個場景，檢查玩家選擇是否改變，並能解釋原因。

「避免把所有肥效都做成可叠加的增产百分比，否则只剩有钱就买的选择。」
出處：`sources/text/farming-fertilizer-tradeoff.json` 字元 3317-3349 `prototype.pitfall.zh`
顯示：避免把所有肥效都做成可疊加的增產百分比，否則只剩有錢就買的選擇。

## 相關模式

- [動態市場](commerce-dynamic-market.md)
- [貿易路線編排](commerce-trade-route-programming.md)
- [灌溉配置](farming-irrigation-layout.md)
- [牲畜照料](farming-livestock-care.md)

## 參考來源

- [Fertilizer investment — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-fertilizer-tradeoff/) — 查閱：2026-11-02；取得方式：page-text。
