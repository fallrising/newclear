---
{
  "schema_version": 2,
  "id": "deckbuilding-poker-hand-requirements",
  "title": "牌型作為行動條件",
  "title_en": "Using card patterns as action requirements",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "planning",
    "randomness"
  ],
  "summary": "同一手扑克可以凑成不同组合，用哪一组决定你能做什么。",
  "note_status": "draft",
  "related": [
    "deckbuilding-dice-allocation",
    "deckbuilding-discard-redraw",
    "deckbuilding-reward-choice",
    "deckbuilding-dual-use-cards"
  ],
  "sources": [
    {
      "title": "Using card patterns as action requirements — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-poker-hand-requirements/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一手扑克可以凑成不同组合，用哪一组决定你能做什么。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 214-240 `summary.zh`
顯示：同一手撲克可以湊成不同組合，用哪一組決定你能做什麼。

## 規則

「行动或得分要求由对子、同花、连续数字等牌型定义，玩家从手牌中选出满足条件的一组。使用这些牌后，可留给其他行动的组合会改变，因此强牌型不一定总是最合适。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 371-446 `rules.zh`
顯示：行動或得分要求由對子、同花、連續數字等牌型定義，玩家從手牌中選出滿足條件的一組。使用這些牌後，可留給其他行動的組合會改變，因此強牌型不一定總是最合適。

## 核心循環

「观察手牌关系」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 686-692 `loop[0].zh`
顯示：觀察手牌關係

「列出可达成的牌型」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 766-774 `loop[1].zh`
顯示：列出可達成的牌型

「按目标分配牌组」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 846-853 `loop[2].zh`
顯示：按目標分配牌組

「更新剩余组合」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 931-937 `loop[3].zh`
顯示：更新剩餘組合

## 玩家取捨

「用对子完成眼前的小收益，还是消耗更多牌去凑更强效果？」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 1030-1056 `decisions[0].zh`
顯示：用對子完成眼前的小收益，還是消耗更多牌去湊更強效果？

「同一张牌能补两种组合，把它给攻击还是防守？」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 1171-1192 `decisions[1].zh`
顯示：同一張牌能補兩種組合，把它給攻擊還是防守？

## 可調參數

「牌型条件难度」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 1341-1347 `parameters[0].name.zh`
顯示：牌型條件難度

「条件越难，成功越有成就感，但需要更多抽牌或修牌支持。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 1427-1453 `parameters[0].effect.zh`
顯示：條件越難，成功越有成就感，但需要更多抽牌或修牌支持。

「小牌型保底收益」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 1603-1610 `parameters[1].name.zh`

「给普通组合可靠用途，能减少坏手牌直接失去一回合。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 1688-1712 `parameters[1].effect.zh`
顯示：給普通組合可靠用途，能減少壞手牌直接失去一回合。

## 原型

「只用两种花色和对子、三张同花两个条件，配一个攻击和一个防守行动。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 3142-3174 `prototype.firstStep.zh`
顯示：只用兩種花色和對子、三張同花兩個條件，配一個攻擊和一個防守行動。

「玩家能发现一张牌被多个组合争用，并选择牺牲其中一个。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 3468-3494 `prototype.test.zh`
顯示：玩家能發現一張牌被多個組合爭用，並選擇犧牲其中一個。

「别急着实现全部扑克牌型；先保证界面能解释为什么一组牌合法。」
出處：`sources/text/deckbuilding-poker-hand-requirements.json` 字元 3313-3342 `prototype.pitfall.zh`
顯示：別急着實現全部撲克牌型；先保證界面能解釋爲什麼一組牌合法。

## 相關模式

- [骰子配給](deckbuilding-dice-allocation.md)
- [棄牌重抽](deckbuilding-discard-redraw.md)
- [獎勵選擇](deckbuilding-reward-choice.md)
- [同一張牌的兩種用途](deckbuilding-dual-use-cards.md)

## 參考來源

- [Using card patterns as action requirements — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-poker-hand-requirements/) — 查閱：2026-11-02；取得方式：page-text。
