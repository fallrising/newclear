---
{
  "schema_version": 2,
  "id": "combat-surface-reactions",
  "title": "表面反應",
  "title_en": "Reactive combat surfaces",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "creativity",
    "spatial"
  ],
  "summary": "技能不仅打人，还能改写脚下的战场。",
  "note_status": "draft",
  "related": [
    "combat-action-points",
    "combat-cover-flanking",
    "combat-destructible-cover",
    "combat-forced-movement"
  ],
  "sources": [
    {
      "title": "Reactive combat surfaces — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-surface-reactions/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「技能不仅打人，还能改写脚下的战场。」
出處：`sources/text/combat-surface-reactions.json` 字元 176-193 `summary.zh`
顯示：技能不僅打人，還能改寫腳下的戰場。

## 規則

「先铺设或发现水、油等地表，再用火、冰、电等效果改变其状态。变换后的区域影响敌我走位和状态；施放顺序与覆盖范围比单个技能伤害更重要。」
出處：`sources/text/combat-surface-reactions.json` 字元 306-371 `rules.zh`
顯示：先鋪設或發現水、油等地表，再用火、冰、電等效果改變其狀態。變換後的區域影響敵我走位和狀態；施放順序與覆蓋範圍比單個技能傷害更重要。

## 核心循環

「检查地表与站位」
出處：`sources/text/combat-surface-reactions.json` 字元 611-618 `loop[0].zh`
顯示：檢查地表與站位

「铺设可反应介质」
出處：`sources/text/combat-surface-reactions.json` 字元 692-699 `loop[1].zh`
顯示：鋪設可反應介質

「施加元素触发变化」
出處：`sources/text/combat-surface-reactions.json` 字元 767-775 `loop[2].zh`
顯示：施加元素觸發變化

「利用或避开新区域」
出處：`sources/text/combat-surface-reactions.json` 字元 847-855 `loop[3].zh`
顯示：利用或避開新區域

## 玩家取捨

「连锁会波及友军，最强组合未必适合当前站位。」
出處：`sources/text/combat-surface-reactions.json` 字元 949-970 `decisions[0].zh`
顯示：連鎖會波及友軍，最強組合未必適合當前站位。

「先造地表再攻击要付出两步，何时值得提前布置？」
出處：`sources/text/combat-surface-reactions.json` 字元 1111-1133 `decisions[1].zh`
顯示：先造地表再攻擊要付出兩步，何時值得提前佈置？

## 可調參數

「反应持续时间」
出處：`sources/text/combat-surface-reactions.json` 字元 1282-1288 `parameters[0].name.zh`
顯示：反應持續時間

「持续越久，战斗越像改造地形；短持续更偏即时连招。」
出處：`sources/text/combat-surface-reactions.json` 字元 1367-1391 `parameters[0].effect.zh`
顯示：持續越久，戰鬥越像改造地形；短持續更偏即時連招。

「友方影响」
出處：`sources/text/combat-surface-reactions.json` 字元 1554-1558 `parameters[1].name.zh`
顯示：友方影響

「友军也受影响时，范围规划的重要性明显提高。」
出處：`sources/text/combat-surface-reactions.json` 字元 1637-1658 `parameters[1].effect.zh`
顯示：友軍也受影響時，範圍規劃的重要性明顯提高。

## 原型

「只实现水、油、火三种地表和一张格子地图，用规则表明确转换结果。」
出處：`sources/text/combat-surface-reactions.json` 字元 3194-3225 `prototype.firstStep.zh`
顯示：只實現水、油、火三種地表和一張格子地圖，用規則表明確轉換結果。

「观察玩家是否为地表效果改变施放顺序，并能预测友军受到的影响。」
出處：`sources/text/combat-surface-reactions.json` 字元 3530-3560 `prototype.test.zh`
顯示：觀察玩家是否爲地表效果改變施放順序，並能預測友軍受到的影響。

「每增加一种元素都会增加交互组合；先限制传播范围和持续时间。」
出處：`sources/text/combat-surface-reactions.json` 字元 3362-3391 `prototype.pitfall.zh`
顯示：每增加一種元素都會增加交互組合；先限制傳播範圍和持續時間。

## 相關模式

- [行動點數](combat-action-points.md)
- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)
- [強制移動](combat-forced-movement.md)

## 參考來源

- [Reactive combat surfaces — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-surface-reactions/) — 查閱：2026-11-02；取得方式：page-text。
