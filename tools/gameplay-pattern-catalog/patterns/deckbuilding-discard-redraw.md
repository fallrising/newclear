---
{
  "schema_version": 2,
  "id": "deckbuilding-discard-redraw",
  "title": "棄牌重抽",
  "title_en": "Selective discarding and redrawing",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "randomness",
    "risk",
    "planning"
  ],
  "summary": "保留快要成形的组合，用有限换牌次数修补缺口。",
  "note_status": "draft",
  "related": [
    "deckbuilding-dice-allocation",
    "deckbuilding-dual-use-cards",
    "deckbuilding-exhaust-for-burst",
    "deckbuilding-poker-hand-requirements"
  ],
  "sources": [
    {
      "title": "Selective discarding and redrawing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-discard-redraw/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「保留快要成形的组合，用有限换牌次数修补缺口。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 198-220 `summary.zh`
顯示：保留快要成形的組合，用有限換牌次數修補缺口。

## 規則

「玩家从当前手牌中挑出暂时无用的牌，丢弃后按规则补抽。换牌次数、费用或触发条件有限，所以不是每次都该追求完美手牌；丢弃本身还可能触发别的效果。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 335-405 `rules.zh`
顯示：玩家從當前手牌中挑出暫時無用的牌，丟棄後按規則補抽。換牌次數、費用或觸發條件有限，所以不是每次都該追求完美手牌；丟棄本身還可能觸發別的效果。

## 核心循環

「判断现有手牌潜力」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 631-639 `loop[0].zh`
顯示：判斷現有手牌潛力

「选定要保留的部分」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 706-714 `loop[1].zh`
顯示：選定要保留的部分

「支付换牌成本」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 778-784 `loop[2].zh`
顯示：支付換牌成本

「用新手牌完成行动」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 844-852 `loop[3].zh`
顯示：用新手牌完成行動

## 玩家取捨

「留下接近成形的大组合，还是接受眼前更稳的小收益？」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 942-966 `decisions[0].zh`
顯示：留下接近成形的大組合，還是接受眼前更穩的小收益？

「把仅剩一次换牌用在现在，还是留给后面更差的手牌？」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 1082-1106 `decisions[1].zh`
顯示：把僅剩一次換牌用在現在，還是留給後面更差的手牌？

## 可調參數

「可丢弃张数」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 1242-1247 `parameters[0].name.zh`
顯示：可丟棄張數

「一次能换越多，寻找特定组合越容易。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 1321-1338 `parameters[0].effect.zh`
顯示：一次能換越多，尋找特定組合越容易。

「每战换牌预算」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 1467-1473 `parameters[1].name.zh`
顯示：每戰換牌預算

「次数越少，当前收益和未来保险之间的取舍越强。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 1548-1570 `parameters[1].effect.zh`
顯示：次數越少，當前收益和未來保險之間的取捨越強。

## 原型

「用三种颜色、一个四张同色目标和每轮两次换牌做纸面原型。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 3010-3037 `prototype.firstStep.zh`
顯示：用三種顏色、一個四張同色目標和每輪兩次換牌做紙面原型。

「玩家会保留部分牌，而不是每次全换；并能解释为什么停止追牌。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 3319-3348 `prototype.test.zh`
顯示：玩家會保留部分牌，而不是每次全換；並能解釋爲什麼停止追牌。

「先别加入弃牌连锁收益，否则难以判断基础换牌决策是否成立。」
出處：`sources/text/deckbuilding-discard-redraw.json` 字元 3169-3197 `prototype.pitfall.zh`
顯示：先別加入棄牌連鎖收益，否則難以判斷基礎換牌決策是否成立。

## 相關模式

- [骰子配給](deckbuilding-dice-allocation.md)
- [同一張牌的兩種用途](deckbuilding-dual-use-cards.md)
- [耗盡爆發](deckbuilding-exhaust-for-burst.md)
- [牌型作為行動條件](deckbuilding-poker-hand-requirements.md)

## 參考來源

- [Selective discarding and redrawing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-discard-redraw/) — 查閱：2026-11-02；取得方式：page-text。
