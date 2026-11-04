---
{
  "schema_version": 2,
  "id": "projectiles-piercing-line",
  "title": "穿透射線對齊",
  "title_en": "Line up targets for a piercing shot",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "spatial",
    "planning",
    "optimization"
  ],
  "summary": "一发不在第一个目标处停下，站位就能换来额外命中。",
  "note_status": "draft",
  "related": [
    "combat-action-points",
    "combat-combat-deck-cycle",
    "combat-cover-flanking",
    "combat-destructible-cover"
  ],
  "sources": [
    {
      "title": "Line up targets for a piercing shot — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-piercing-line/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一发不在第一个目标处停下，站位就能换来额外命中。」
出處：`sources/text/projectiles-piercing-line.json` 字元 199-223 `summary.zh`
顯示：一發不在第一個目標處停下，站位就能換來額外命中。

## 規則

「贯穿弹命中目标后继续前进，直到耗尽穿透次数、距离或能量。玩家移动到能把敌人排成一线的位置，再决定立即射击还是等队形更集中；命中顺序和衰减影响后排收益。」
出處：`sources/text/projectiles-piercing-line.json` 字元 336-411 `rules.zh`
顯示：貫穿彈命中目標後繼續前進，直到耗盡穿透次數、距離或能量。玩家移動到能把敵人排成一線的位置，再決定立即射擊還是等隊形更集中；命中順序和衰減影響後排收益。

## 核心循環

「观察目标之间的相对位置」
出處：`sources/text/projectiles-piercing-line.json` 字元 679-690 `loop[0].zh`
顯示：觀察目標之間的相對位置

「调整站位形成一条线」
出處：`sources/text/projectiles-piercing-line.json` 字元 768-777 `loop[1].zh`
顯示：調整站位形成一條線

「发射并查看贯穿结果」
出處：`sources/text/projectiles-piercing-line.json` 字元 846-855 `loop[2].zh`
顯示：發射並查看貫穿結果

「趁敌人重新散开再选位置」
出處：`sources/text/projectiles-piercing-line.json` 字元 931-942 `loop[3].zh`
顯示：趁敵人重新散開再選位置

## 玩家取捨

「先打掉前排威胁，还是等后排靠近后一起贯穿？」
出處：`sources/text/projectiles-piercing-line.json` 字元 1046-1067 `decisions[0].zh`
顯示：先打掉前排威脅，還是等後排靠近後一起貫穿？

「为了多打一人而绕到侧面，是否会暴露给另一组敌人？」
出處：`sources/text/projectiles-piercing-line.json` 字元 1176-1200 `decisions[1].zh`
顯示：爲了多打一人而繞到側面，是否會暴露給另一組敵人？

## 可調參數

「贯穿上限」
出處：`sources/text/projectiles-piercing-line.json` 字元 1353-1357 `parameters[0].name.zh`
顯示：貫穿上限

「上限低强调精确排队；上限高更依赖场地和敌群密度来控制收益。」
出處：`sources/text/projectiles-piercing-line.json` 字元 1436-1465 `parameters[0].effect.zh`
顯示：上限低強調精確排隊；上限高更依賴場地和敵羣密度來控制收益。

「逐目标伤害衰减」
出處：`sources/text/projectiles-piercing-line.json` 字元 1638-1645 `parameters[1].name.zh`
顯示：逐目標傷害衰減

「衰减明显时，玩家还要决定把谁放在第一命中位。」
出處：`sources/text/projectiles-piercing-line.json` 字元 1730-1752 `parameters[1].effect.zh`
顯示：衰減明顯時，玩家還要決定把誰放在第一命中位。

## 原型

「先做三个圆形目标、一次最多命中两人的直线弹，以及命中次序标记。」
出處：`sources/text/projectiles-piercing-line.json` 字元 3155-3186 `prototype.firstStep.zh`
顯示：先做三個圓形目標、一次最多命中兩人的直線彈，以及命中次序標記。

「玩家是否为了第二次命中主动改变站位，而不是只提高射速？」
出處：`sources/text/projectiles-piercing-line.json` 字元 3519-3546 `prototype.test.zh`
顯示：玩家是否爲了第二次命中主動改變站位，而不是隻提高射速？

「同一弹丸不可每帧重复伤害同一目标；命中与继续穿过的反馈要分清。」
出處：`sources/text/projectiles-piercing-line.json` 字元 3341-3372 `prototype.pitfall.zh`
顯示：同一彈丸不可每幀重複傷害同一目標；命中與繼續穿過的反饋要分清。

## 相關模式

- [行動點數](combat-action-points.md)
- [戰鬥牌組循環](combat-combat-deck-cycle.md)
- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)

## 參考來源

- [Line up targets for a piercing shot — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-piercing-line/) — 查閱：2026-11-02；取得方式：page-text。
