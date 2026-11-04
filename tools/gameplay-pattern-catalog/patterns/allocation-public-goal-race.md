---
{
  "schema_version": 2,
  "id": "allocation-public-goal-race",
  "title": "公開目標競速",
  "title_en": "Race for a public objective reward",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "planning",
    "timing"
  ],
  "summary": "进度够了还要赶得上，奖励可能先被别人拿走。",
  "note_status": "draft",
  "related": [
    "allocation-area-majority",
    "allocation-follow-phase",
    "allocation-public-pick",
    "allocation-snake-order"
  ],
  "sources": [
    {
      "title": "Race for a public objective reward — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-public-goal-race/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「进度够了还要赶得上，奖励可能先被别人拿走。」
出處：`sources/text/allocation-public-goal-race.json` 字元 197-218 `summary.zh`
顯示：進度夠了還要趕得上，獎勵可能先被別人拿走。

## 規則

「多人能争取同一公开目标，但奖励名额有限或先到者先持有。玩家观察彼此进度，决定为抢先完成投入多少；有人得手后，其他人需要换目标，或按规则继续追赶争回奖励。」
出處：`sources/text/allocation-public-goal-race.json` 字元 333-409 `rules.zh`
顯示：多人能爭取同一公開目標，但獎勵名額有限或先到者先持有。玩家觀察彼此進度，決定爲搶先完成投入多少；有人得手後，其他人需要換目標，或按規則繼續追趕爭回獎勵。

## 核心循環

「比较公开目标与双方进度」
出處：`sources/text/allocation-public-goal-race.json` 字元 706-717 `loop[0].zh`
顯示：比較公開目標與雙方進度

「集中资源加快完成」
出處：`sources/text/allocation-public-goal-race.json` 字元 792-800 `loop[1].zh`
顯示：集中資源加快完成

「领取或失去争夺机会」
出處：`sources/text/allocation-public-goal-race.json` 字元 877-886 `loop[2].zh`
顯示：領取或失去爭奪機會

「切换目标或继续追赶」
出處：`sources/text/allocation-public-goal-race.json` 字元 970-979 `loop[3].zh`
顯示：切換目標或繼續追趕

## 玩家取捨

「花额外资源抢这一轮完成，还是冒着被抢的风险慢慢积累？」
出處：`sources/text/allocation-public-goal-race.json` 字元 1074-1100 `decisions[0].zh`
顯示：花額外資源搶這一輪完成，還是冒着被搶的風險慢慢積累？

「落后时继续追这个目标，还是转向竞争较少的目标？」
出處：`sources/text/allocation-public-goal-race.json` 字元 1204-1227 `decisions[1].zh`
顯示：落後時繼續追這個目標，還是轉向競爭較少的目標？

## 可調參數

「奖励名额」
出處：`sources/text/allocation-public-goal-race.json` 字元 1362-1366 `parameters[0].name.zh`
顯示：獎勵名額

「名额越少，观察对手进度越重要；名额过少可能让后来者无事可做。」
出處：`sources/text/allocation-public-goal-race.json` 字元 1440-1470 `parameters[0].effect.zh`
顯示：名額越少，觀察對手進度越重要；名額過少可能讓後來者無事可做。

「是否能被夺回」
出處：`sources/text/allocation-public-goal-race.json` 字元 1633-1639 `parameters[1].name.zh`
顯示：是否能被奪回

「永久领取鼓励冲刺，可夺回奖励还需要后续维护。」
出處：`sources/text/allocation-public-goal-race.json` 字元 1715-1737 `parameters[1].effect.zh`
顯示：永久領取鼓勵衝刺，可奪回獎勵還需要後續維護。

## 原型

「给两名本地玩家三个公开目标，先只做一次领取、立即移除的奖励。」
出處：`sources/text/allocation-public-goal-race.json` 字元 3225-3255 `prototype.firstStep.zh`
顯示：給兩名本地玩家三個公開目標，先只做一次領取、立即移除的獎勵。

「玩家会不会因对手接近完成而加速、改目标或及时止损？」
出處：`sources/text/allocation-public-goal-race.json` 字元 3549-3574 `prototype.test.zh`
顯示：玩家會不會因對手接近完成而加速、改目標或及時止損？

「必须区分达到条件与真正领取，避免玩家觉得奖励被无故抢走。」
出處：`sources/text/allocation-public-goal-race.json` 字元 3395-3423 `prototype.pitfall.zh`
顯示：必須區分達到條件與真正領取，避免玩家覺得獎勵被無故搶走。

## 相關模式

- [區域多數](allocation-area-majority.md)
- [跟進階段](allocation-follow-phase.md)
- [公開選取](allocation-public-pick.md)
- [蛇形輪選的補償](allocation-snake-order.md)

## 參考來源

- [Race for a public objective reward — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-public-goal-race/) — 查閱：2026-11-02；取得方式：page-text。
