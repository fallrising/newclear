---
{
  "schema_version": 2,
  "id": "combat-forced-movement",
  "title": "強制移動",
  "title_en": "Forced movement",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "spatial",
    "planning",
    "risk"
  ],
  "summary": "把敌人送到不该站的位置，有时比直接扣血更有效。",
  "note_status": "draft",
  "related": [
    "combat-cover-flanking",
    "combat-destructible-cover",
    "combat-friendly-fire",
    "combat-overwatch"
  ],
  "sources": [
    {
      "title": "Forced movement — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-forced-movement/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把敌人送到不该站的位置，有时比直接扣血更有效。」
出處：`sources/text/combat-forced-movement.json` 字元 167-190 `summary.zh`
顯示：把敵人送到不該站的位置，有時比直接扣血更有效。

## 規則

「攻击除了伤害，还会把目标沿方向推走或拉近。新位置会改变攻击目标、障碍关系和危险地形的作用。玩家先预估落点，再选择施力方向；位移后的局面成为下一步行动的起点。」
出處：`sources/text/combat-forced-movement.json` 字元 299-377 `rules.zh`
顯示：攻擊除了傷害，還會把目標沿方向推走或拉近。新位置會改變攻擊目標、障礙關係和危險地形的作用。玩家先預估落點，再選擇施力方向；位移後的局面成爲下一步行動的起點。

## 核心循環

「找出危险落点」
出處：`sources/text/combat-forced-movement.json` 字元 628-634 `loop[0].zh`
顯示：找出危險落點

「调整施力位置」
出處：`sources/text/combat-forced-movement.json` 字元 703-709 `loop[1].zh`
顯示：調整施力位置

「推开或拉近目标」
出處：`sources/text/combat-forced-movement.json` 字元 774-781 `loop[2].zh`
顯示：推開或拉近目標

「利用新站位」
出處：`sources/text/combat-forced-movement.json` 字元 848-853 `loop[3].zh`

## 玩家取捨

「直接打伤害，还是用位移让敌人的攻击落空？」
出處：`sources/text/combat-forced-movement.json` 字元 942-962 `decisions[0].zh`
顯示：直接打傷害，還是用位移讓敵人的攻擊落空？

「把敌人推出战场，是否也会失去可回收的战利品？」
出處：`sources/text/combat-forced-movement.json` 字元 1068-1090 `decisions[1].zh`
顯示：把敵人推出戰場，是否也會失去可回收的戰利品？

## 可調參數

「位移距离」
出處：`sources/text/combat-forced-movement.json` 字元 1236-1240 `parameters[0].name.zh`
顯示：位移距離

「距离改变可达落点；过长会让站位准备失去意义。」
出處：`sources/text/combat-forced-movement.json` 字元 1323-1345 `parameters[0].effect.zh`
顯示：距離改變可達落點；過長會讓站位準備失去意義。

「碰撞规则」
出處：`sources/text/combat-forced-movement.json` 字元 1491-1495 `parameters[1].name.zh`
顯示：碰撞規則

「撞墙、撞人和落坑的结果必须分别清楚，玩家才能预判。」
出處：`sources/text/combat-forced-movement.json` 字元 1572-1597 `parameters[1].effect.zh`
顯示：撞牆、撞人和落坑的結果必須分別清楚，玩家才能預判。

## 原型

「只做四方向推一格、墙和坑；先不用真实物理模拟。」
出處：`sources/text/combat-forced-movement.json` 字元 2978-3001 `prototype.firstStep.zh`
顯示：只做四方向推一格、牆和坑；先不用真實物理模擬。

「给出同一敌人的三种站位，看试玩者能否提出不同解法。」
出處：`sources/text/combat-forced-movement.json` 字元 3290-3315 `prototype.test.zh`
顯示：給出同一敵人的三種站位，看試玩者能否提出不同解法。

「落点不可见或碰撞结算顺序含糊，会让空间决策变成试错。」
出處：`sources/text/combat-forced-movement.json` 字元 3130-3156 `prototype.pitfall.zh`
顯示：落點不可見或碰撞結算順序含糊，會讓空間決策變成試錯。

## 相關模式

- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)
- [範圍攻擊的友方誤傷](combat-friendly-fire.md)
- [警戒射擊](combat-overwatch.md)

## 參考來源

- [Forced movement — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-forced-movement/) — 查閱：2026-11-02；取得方式：page-text。
