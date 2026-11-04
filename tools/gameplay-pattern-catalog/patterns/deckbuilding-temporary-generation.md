---
{
  "schema_version": 2,
  "id": "deckbuilding-temporary-generation",
  "title": "暫時生成",
  "title_en": "Generating cards during combat",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "planning",
    "optimization"
  ],
  "summary": "用一张牌或一个单位，在这一战里制造额外的行动材料。",
  "note_status": "draft",
  "related": [
    "deckbuilding-dice-allocation",
    "deckbuilding-duplicate-investment",
    "deckbuilding-opening-hand-control",
    "deckbuilding-reward-choice"
  ],
  "sources": [
    {
      "title": "Generating cards during combat — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-temporary-generation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用一张牌或一个单位，在这一战里制造额外的行动材料。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 200-225 `summary.zh`
顯示：用一張牌或一個單位，在這一戰裏製造額外的行動材料。

## 規則

「部分效果把原牌库没有的牌加入手牌或弃牌区，只影响当前战斗。玩家要安排生成时机、手牌空间和后续出牌费用；生成牌可能马上消耗，也可能继续参与本战循环。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 343-416 `rules.zh`
顯示：部分效果把原牌庫沒有的牌加入手牌或棄牌區，隻影響當前戰鬥。玩家要安排生成時機、手牌空間和後續出牌費用；生成牌可能馬上消耗，也可能繼續參與本戰循環。

## 核心循環

「启动造牌效果」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 666-672 `loop[0].zh`
顯示：啓動造牌效果

「检查手牌和费用」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 741-748 `loop[1].zh`
顯示：檢查手牌和費用

「使用新生成的牌」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 818-825 `loop[2].zh`

「让造牌节奏配合战况」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 891-900 `loop[3].zh`
顯示：讓造牌節奏配合戰況

## 玩家取捨

「先开增益再造小攻击，还是先造牌确保本回合能清场？」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 998-1022 `decisions[0].zh`
顯示：先開增益再造小攻擊，還是先造牌確保本回合能清場？

「持续造牌的单位占了战场位置，产出的牌是否值得这个位置？」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 1140-1167 `decisions[1].zh`
顯示：持續造牌的單位佔了戰場位置，產出的牌是否值得這個位置？

## 可調參數

「每次产牌数」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 1319-1324 `parameters[0].name.zh`
顯示：每次產牌數

「数量越多越能触发连击，也越容易挤满手牌。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 1403-1423 `parameters[0].effect.zh`
顯示：數量越多越能觸發連擊，也越容易擠滿手牌。

「生成牌去向」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 1556-1561 `parameters[1].name.zh`

「直接入手立即见效；进弃牌区则要等待下一轮洗牌。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 1634-1657 `parameters[1].effect.zh`
顯示：直接入手立即見效；進棄牌區則要等待下一輪洗牌。

## 原型

「先做一种生成牌、一个产牌效果和明确的手牌上限。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 3072-3095 `prototype.firstStep.zh`
顯示：先做一種生成牌、一個產牌效果和明確的手牌上限。

「玩家会为了产牌提前清出手牌空间，并理解战后这些牌不会留下。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 3366-3395 `prototype.test.zh`
顯示：玩家會爲了產牌提前清出手牌空間，並理解戰後這些牌不會留下。

「生成牌再生成自身会造成无限链；首版禁止递归造牌。」
出處：`sources/text/deckbuilding-temporary-generation.json` 字元 3218-3242 `prototype.pitfall.zh`
顯示：生成牌再生成自身會造成無限鏈；首版禁止遞歸造牌。

## 相關模式

- [骰子配給](deckbuilding-dice-allocation.md)
- [複製投入](deckbuilding-duplicate-investment.md)
- [起手牌的可控範圍](deckbuilding-opening-hand-control.md)
- [獎勵選擇](deckbuilding-reward-choice.md)

## 參考來源

- [Generating cards during combat — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-temporary-generation/) — 查閱：2026-11-02；取得方式：page-text。
