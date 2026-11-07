---
{
  "schema_version": 2,
  "id": "command-initiative-order",
  "title": "先攻順序",
  "title_en": "Tune speed to arrange turn order",
  "category": "command",
  "source_category": "command",
  "tags": [
    "planning",
    "timing"
  ],
  "summary": "让先手留给铺垫者，再让收割者接上。",
  "note_status": "draft",
  "related": [
    "combat-stamina-budget",
    "command-focus-fire",
    "command-frontline-shielding",
    "command-interrupt-action"
  ],
  "sources": [
    {
      "title": "Tune speed to arrange turn order — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-initiative-order/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让先手留给铺垫者，再让收割者接上。」
出處：`sources/text/command-initiative-order.json` 字元 189-206 `summary.zh`
顯示：讓先手留給鋪墊者，再讓收割者接上。

## 規則

「玩家通过配装、属性或状态改变单位的出手先后，让减防、治疗与攻击按需要衔接。速度不一定增加行动次数；还要看敌我是否交替、每轮是否重排。行动队列或实际出手结果给出反馈。」
出處：`sources/text/command-initiative-order.json` 字元 292-374 `rules.zh`
顯示：玩家通過配裝、屬性或狀態改變單位的出手先後，讓減防、治療與攻擊按需要銜接。速度不一定增加行動次數；還要看敵我是否交替、每輪是否重排。行動隊列或實際出手結果給出反饋。

## 核心循環

「观察当前出手顺序」
出處：`sources/text/command-initiative-order.json` 字元 668-676 `loop[0].zh`
顯示：觀察當前出手順序

「调整关键单位速度」
出處：`sources/text/command-initiative-order.json` 字元 745-753 `loop[1].zh`
顯示：調整關鍵單位速度

「执行铺垫与后续行动」
出處：`sources/text/command-initiative-order.json` 字元 822-831 `loop[2].zh`
顯示：執行鋪墊與後續行動

「根据敌方先手重新安排」
出處：`sources/text/command-initiative-order.json` 字元 910-920 `loop[3].zh`
顯示：根據敵方先手重新安排

## 玩家取捨

「让治疗者抢先保命，还是让控制者先压住危险敌人？」
出處：`sources/text/command-initiative-order.json` 字元 1020-1043 `decisions[0].zh`
顯示：讓治療者搶先保命，還是讓控制者先壓住危險敵人？

「为抢先手牺牲伤害，能否换来少挨一次攻击？」
出處：`sources/text/command-initiative-order.json` 字元 1170-1190 `decisions[1].zh`
顯示：爲搶先手犧牲傷害，能否換來少挨一次攻擊？

## 可調參數

「速度随机幅度」
出處：`sources/text/command-initiative-order.json` 字元 1337-1343 `parameters[0].name.zh`
顯示：速度隨機幅度

「随机越大，精确连招越不稳定，更需要备用计划。」
出處：`sources/text/command-initiative-order.json` 字元 1426-1448 `parameters[0].effect.zh`
顯示：隨機越大，精確連招越不穩定，更需要備用計劃。

「重排时点」
出處：`sources/text/command-initiative-order.json` 字元 1591-1595 `parameters[1].name.zh`
顯示：重排時點

「每轮重排方便局间调整；实时重排会让加速效果更难预测。」
出處：`sources/text/command-initiative-order.json` 字元 1672-1698 `parameters[1].effect.zh`
顯示：每輪重排方便局間調整；實時重排會讓加速效果更難預測。

## 原型

「做四个单位和一条排序队列，只提供一件改变速度的装备。」
出處：`sources/text/command-initiative-order.json` 字元 3122-3148 `prototype.firstStep.zh`
顯示：做四個單位和一條排序隊列，只提供一件改變速度的裝備。

「玩家能否在开战前说出调整后谁会先动，以及这样做的目的？」
出處：`sources/text/command-initiative-order.json` 字元 3397-3424 `prototype.test.zh`
顯示：玩家能否在開戰前說出調整後誰會先動，以及這樣做的目的？

「别把速度、行动点与行动次数混成一个难读数值。」
出處：`sources/text/command-initiative-order.json` 字元 3266-3288 `prototype.pitfall.zh`
顯示：別把速度、行動點與行動次數混成一個難讀數值。

## 相關模式

- [攻守共用資源預算](combat-stamina-budget.md)
- [集中火力決策](command-focus-fire.md)
- [前線掩護](command-frontline-shielding.md)
- [打斷行動](command-interrupt-action.md)

## 參考來源

- [Tune speed to arrange turn order — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-initiative-order/) — 查閱：2026-11-02；取得方式：page-text。
