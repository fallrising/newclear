---
{
  "schema_version": 2,
  "id": "deckbuilding-dice-allocation",
  "title": "骰子配給",
  "title_en": "Allocating rolled outcomes",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "randomness",
    "planning",
    "optimization"
  ],
  "summary": "骰子先告诉你这回合有什么，再由你决定把它们用在哪里。",
  "note_status": "draft",
  "related": [
    "deckbuilding-reward-choice",
    "deckbuilding-discard-redraw",
    "deckbuilding-duplicate-investment",
    "deckbuilding-opening-hand-control"
  ],
  "sources": [
    {
      "title": "Allocating rolled outcomes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-dice-allocation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「骰子先告诉你这回合有什么，再由你决定把它们用在哪里。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 193-219 `summary.zh`
顯示：骰子先告訴你這回合有什麼，再由你決定把它們用在哪裏。

## 規則

「每回合先掷出一组结果，再由玩家分配给可接受的行动或目标。行动可能要求特定点数、奇偶或效果类型；可用结果有限，玩家要把不理想的骰子也安排出用途。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 338-409 `rules.zh`
顯示：每回合先擲出一組結果，再由玩家分配給可接受的行動或目標。行動可能要求特定點數、奇偶或效果類型；可用結果有限，玩家要把不理想的骰子也安排出用途。

## 核心循環

「掷出本回合骰子」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 648-655 `loop[0].zh`
顯示：擲出本回合骰子

「查看能用的槽位或目标」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 719-729 `loop[1].zh`
顯示：查看能用的槽位或目標

「分配与修正结果」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 804-811 `loop[2].zh`
顯示：分配與修正結果

「结算后准备下一轮」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 882-890 `loop[3].zh`
顯示：結算後準備下一輪

## 玩家取捨

「把高点数给大伤害，还是留给最低点数有要求的辅助行动？」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 988-1014 `decisions[0].zh`
顯示：把高點數給大傷害，還是留給最低點數有要求的輔助行動？

「先重掷坏结果，还是接受它并利用一个有代价的效果？」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 1129-1153 `decisions[1].zh`
顯示：先重擲壞結果，還是接受它並利用一個有代價的效果？

## 可調參數

「结果可调次数」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 1296-1302 `parameters[0].name.zh`
顯示：結果可調次數

「重掷和改面越多，随机性越低，但计算选择会增多。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 1390-1413 `parameters[0].effect.zh`
顯示：重擲和改面越多，隨機性越低，但計算選擇會增多。

「行动限制的交叉程度」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 1561-1570 `parameters[1].name.zh`
顯示：行動限制的交叉程度

「多个行动争用同一类结果时，分配才会产生取舍。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 1656-1678 `parameters[1].effect.zh`
顯示：多個行動爭用同一類結果時，分配纔會產生取捨。

## 原型

「用三颗六面骰和四件带简单条件的装备做单场战斗。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 3163-3186 `prototype.firstStep.zh`
顯示：用三顆六面骰和四件帶簡單條件的裝備做單場戰鬥。

「玩家能找到高点数之外的用途，并会为紧缺槽位保留合适骰子。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 3499-3527 `prototype.test.zh`
顯示：玩家能找到高點數之外的用途，並會爲緊缺槽位保留合適骰子。

「首版只做一种改点能力；大量重掷、复制和锁骰会让穷举变成负担。」
出處：`sources/text/deckbuilding-dice-allocation.json` 字元 3323-3353 `prototype.pitfall.zh`
顯示：首版只做一種改點能力；大量重擲、複製和鎖骰會讓窮舉變成負擔。

## 相關模式

- [獎勵選擇](deckbuilding-reward-choice.md)
- [棄牌重抽](deckbuilding-discard-redraw.md)
- [複製投入](deckbuilding-duplicate-investment.md)
- [起手牌的可控範圍](deckbuilding-opening-hand-control.md)

## 參考來源

- [Allocating rolled outcomes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-dice-allocation/) — 查閱：2026-11-02；取得方式：page-text。
