---
{
  "schema_version": 2,
  "id": "command-trait-thresholds",
  "title": "性狀門檻",
  "title_en": "Reach team bonuses with distinct members",
  "category": "command",
  "source_category": "command",
  "tags": [
    "planning",
    "optimization"
  ],
  "summary": "让一个较弱成员也可能成为阵容缺少的最后一块。",
  "note_status": "draft",
  "related": [
    "command-focus-fire",
    "command-frontline-shielding",
    "command-initiative-order",
    "command-prebattle-formation"
  ],
  "sources": [
    {
      "title": "Reach team bonuses with distinct members — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-trait-thresholds/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让一个较弱成员也可能成为阵容缺少的最后一块。」
出處：`sources/text/command-trait-thresholds.json` 字元 199-221 `summary.zh`
顯示：讓一個較弱成員也可能成爲陣容缺少的最後一塊。

## 規則

「单位带有阵营或职业标签，场上符合条件的不同成员达到门槛时触发团队效果。玩家在个人强度、标签数量和上场名额间取舍；界面应说明缺谁、差几个，以及换人会失去哪档效果。」
出處：`sources/text/command-trait-thresholds.json` 字元 318-398 `rules.zh`
顯示：單位帶有陣營或職業標籤，場上符合條件的不同成員達到門檻時觸發團隊效果。玩家在個人強度、標籤數量和上場名額間取捨；界面應說明缺誰、差幾個，以及換人會失去哪檔效果。

## 核心循環

「检查已有标签人数」
出處：`sources/text/command-trait-thresholds.json` 字元 666-674 `loop[0].zh`
顯示：檢查已有標籤人數

「选择补标签或补强度」
出處：`sources/text/command-trait-thresholds.json` 字元 742-751 `loop[1].zh`
顯示：選擇補標籤或補強度

「触发或失去门槛效果」
出處：`sources/text/command-trait-thresholds.json` 字元 837-846 `loop[2].zh`
顯示：觸發或失去門檻效果

「按战况重组成员」
出處：`sources/text/command-trait-thresholds.json` 字元 924-931 `loop[3].zh`
顯示：按戰況重組成員

## 玩家取捨

「换上弱单位凑出团队加成，是否比单独的强单位更值？」
出處：`sources/text/command-trait-thresholds.json` 字元 1021-1045 `decisions[0].zh`
顯示：換上弱單位湊出團隊加成，是否比單獨的強單位更值？

「追求一条高档加成，还是多条低档加成？」
出處：`sources/text/command-trait-thresholds.json` 字元 1170-1188 `decisions[1].zh`
顯示：追求一條高檔加成，還是多條低檔加成？

## 可調參數

「门槛梯度」
出處：`sources/text/command-trait-thresholds.json` 字元 1325-1329 `parameters[0].name.zh`
顯示：門檻梯度

「间隔大意味着更长的投入期，成型前可能更弱。」
出處：`sources/text/command-trait-thresholds.json` 字元 1408-1429 `parameters[0].effect.zh`
顯示：間隔大意味着更長的投入期，成型前可能更弱。

「加成覆盖对象」
出處：`sources/text/command-trait-thresholds.json` 字元 1562-1568 `parameters[1].name.zh`
顯示：加成覆蓋對象

「只惠及同类更强调专精，惠及全队更鼓励混搭。」
出處：`sources/text/command-trait-thresholds.json` 字元 1646-1667 `parameters[1].effect.zh`
顯示：只惠及同類更強調專精，惠及全隊更鼓勵混搭。

## 原型

「六名单位、两个标签、一个人数门槛，用数字结算战斗即可。」
出處：`sources/text/command-trait-thresholds.json` 字元 3069-3096 `prototype.firstStep.zh`
顯示：六名單位、兩個標籤、一個人數門檻，用數字結算戰鬥即可。

「玩家会不会为补门槛保留看似较弱的单位？」
出處：`sources/text/command-trait-thresholds.json` 字元 3353-3372 `prototype.test.zh`
顯示：玩家會不會爲補門檻保留看似較弱的單位？

「标签与例外太多会把决策变成记忆考试。」
出處：`sources/text/command-trait-thresholds.json` 字元 3221-3239 `prototype.pitfall.zh`
顯示：標籤與例外太多會把決策變成記憶考試。

## 相關模式

- [集中火力決策](command-focus-fire.md)
- [前線掩護](command-frontline-shielding.md)
- [先攻順序](command-initiative-order.md)
- [戰前陣型](command-prebattle-formation.md)

## 參考來源

- [Reach team bonuses with distinct members — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-trait-thresholds/) — 查閱：2026-11-02；取得方式：page-text。
