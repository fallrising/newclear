---
{
  "schema_version": 2,
  "id": "combat-combo-variation",
  "title": "連段變化",
  "title_en": "Combo variety rewards",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "dexterity",
    "creativity",
    "timing"
  ],
  "summary": "不仅要求打赢，还用即时评价推动玩家尝试不同招式。",
  "note_status": "draft",
  "related": [
    "combat-invulnerable-dodge",
    "combat-posture-break",
    "combat-stamina-budget",
    "combat-surface-reactions"
  ],
  "sources": [
    {
      "title": "Combo variety rewards — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-combo-variation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不仅要求打赢，还用即时评价推动玩家尝试不同招式。」
出處：`sources/text/combat-combo-variation.json` 字元 171-195 `summary.zh`
顯示：不僅要求打贏，還用即時評價推動玩家嘗試不同招式。

## 規則

「将不同招式连在一起，维持命中与节奏，得到评价或分数。重复安全招式通常不如变化组合有价值；受击或断连可能损失累积收益。」
出處：`sources/text/combat-combo-variation.json` 字元 298-356 `rules.zh`
顯示：將不同招式連在一起，維持命中與節奏，得到評價或分數。重複安全招式通常不如變化組合有價值；受擊或斷連可能損失累積收益。

## 核心循環

「寻找起手空档」
出處：`sources/text/combat-combo-variation.json` 字元 615-621 `loop[0].zh`
顯示：尋找起手空檔

「串接不同招式」
出處：`sources/text/combat-combo-variation.json` 字元 680-686 `loop[1].zh`

「应对敌人反击」
出處：`sources/text/combat-combo-variation.json` 字元 747-753 `loop[2].zh`
顯示：應對敵人反擊

「完成连招结算」
出處：`sources/text/combat-combo-variation.json` 字元 819-825 `loop[3].zh`
顯示：完成連招結算

## 玩家取捨

「继续炫技能提高评价，提前收手却更安全。」
出處：`sources/text/combat-combo-variation.json` 字元 919-938 `decisions[0].zh`
顯示：繼續炫技能提高評價，提前收手卻更安全。

「继续使用熟悉的招式，还是冒衔接失误的风险换一套动作？」
出處：`sources/text/combat-combo-variation.json` 字元 1059-1085 `decisions[1].zh`
顯示：繼續使用熟悉的招式，還是冒銜接失誤的風險換一套動作？

## 可調參數

「重复惩罚」
出處：`sources/text/combat-combo-variation.json` 字元 1238-1242 `parameters[0].name.zh`
顯示：重複懲罰

「惩罚越明显，玩家越有动力使用整个招式库。」
出處：`sources/text/combat-combo-variation.json` 字元 1322-1342 `parameters[0].effect.zh`
顯示：懲罰越明顯，玩家越有動力使用整個招式庫。

「断连宽限」
出處：`sources/text/combat-combo-variation.json` 字元 1466-1470 `parameters[1].name.zh`
顯示：斷連寬限

「更宽松的时间允许观察敌人，更严格的时间鼓励持续进攻。」
出處：`sources/text/combat-combo-variation.json` 字元 1550-1576 `parameters[1].effect.zh`
顯示：更寬鬆的時間允許觀察敵人，更嚴格的時間鼓勵持續進攻。

## 原型

「做三个可衔接动作、重复动作衰减和一条即时评价条。」
出處：`sources/text/combat-combo-variation.json` 字元 3089-3113 `prototype.firstStep.zh`
顯示：做三個可銜接動作、重複動作衰減和一條即時評價條。

「比较有无评价奖励的试玩，观察玩家是否主动尝试不同衔接。」
出處：`sources/text/combat-combo-variation.json` 字元 3438-3465 `prototype.test.zh`
顯示：比較有無評價獎勵的試玩，觀察玩家是否主動嘗試不同銜接。

「大量招式并不能替代顺畅衔接；输入缓冲和动作取消规则要先统一。」
出處：`sources/text/combat-combo-variation.json` 字元 3258-3288 `prototype.pitfall.zh`
顯示：大量招式並不能替代順暢銜接；輸入緩衝和動作取消規則要先統一。

## 相關模式

- [無敵閃避](combat-invulnerable-dodge.md)
- [架勢崩解](combat-posture-break.md)
- [攻守共用資源預算](combat-stamina-budget.md)
- [表面反應](combat-surface-reactions.md)

## 參考來源

- [Combo variety rewards — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-combo-variation/) — 查閱：2026-11-02；取得方式：page-text。
