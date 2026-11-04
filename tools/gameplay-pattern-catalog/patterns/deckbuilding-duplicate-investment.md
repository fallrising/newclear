---
{
  "schema_version": 2,
  "id": "deckbuilding-duplicate-investment",
  "title": "複製投入",
  "title_en": "Copying an invested card",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "planning",
    "progression",
    "optimization"
  ],
  "summary": "复制不只是多一张牌，也能把此前的强化一起复制出去。",
  "note_status": "draft",
  "related": [
    "automation-production-chain",
    "deckbuilding-card-upgrade",
    "deckbuilding-dice-allocation",
    "deckbuilding-opening-hand-control"
  ],
  "sources": [
    {
      "title": "Copying an invested card — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-duplicate-investment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「复制不只是多一张牌，也能把此前的强化一起复制出去。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 193-218 `summary.zh`
顯示：複製不只是多一張牌，也能把此前的強化一起複製出去。

## 規則

「在稀有机会中，玩家从已有牌中挑一张，生成保留其允许属性的副本。复制提高该功能的出现频率，也可能放大之前的升级投入；副本仍会增加牌库体积和使用成本。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 337-410 `rules.zh`
顯示：在稀有機會中，玩家從已有牌中挑一張，生成保留其允許屬性的副本。複製提高該功能的出現頻率，也可能放大之前的升級投入；副本仍會增加牌庫體積和使用成本。

## 核心循環

「先集中资源养牌」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 654-661 `loop[0].zh`
顯示：先集中資源養牌

「找到复制机会」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 728-734 `loop[1].zh`
顯示：找到複製機會

「选择复制目标」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 809-815 `loop[2].zh`
顯示：選擇複製目標

「调整重复功能的比例」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 876-885 `loop[3].zh`
顯示：調整重複功能的比例

## 玩家取捨

「复制最强攻击，还是复制唯一能让整套组合启动的辅助牌？」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 979-1005 `decisions[0].zh`
顯示：複製最強攻擊，還是複製唯一能讓整套組合啓動的輔助牌？

「要先升级再复制，还是立即复制以保证接下来的生存？」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 1115-1139 `decisions[1].zh`
顯示：要先升級再複製，還是立即複製以保證接下來的生存？

## 可調參數

「继承属性范围」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 1294-1300 `parameters[0].name.zh`
顯示：繼承屬性範圍

「若副本继承强化，早期集中投资更有价值。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 1379-1398 `parameters[0].effect.zh`
顯示：若副本繼承強化，早期集中投資更有價值。

「复制机会频率」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 1542-1548 `parameters[1].name.zh`
顯示：複製機會頻率

「越频繁越容易形成重复牌组，需要关注费用与功能覆盖。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 1631-1656 `parameters[1].effect.zh`
顯示：越頻繁越容易形成重複牌組，需要關注費用與功能覆蓋。

## 原型

「做六张可升级牌和一次复制节点，明确显示副本继承的属性。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 3086-3113 `prototype.firstStep.zh`
顯示：做六張可升級牌和一次複製節點，明確顯示副本繼承的屬性。

「玩家会因未来复制机会改变当前升级对象，且知道副本仍需支付出牌费用。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 3386-3419 `prototype.test.zh`
顯示：玩家會因未來複制機會改變當前升級對象，且知道副本仍需支付出牌費用。

「不要允许复制过程再次触发自身复制；先限定一次操作产生一个普通副本。」
出處：`sources/text/deckbuilding-duplicate-investment.json` 字元 3244-3277 `prototype.pitfall.zh`
顯示：不要允許複製過程再次觸發自身複製；先限定一次操作產生一個普通副本。

## 相關模式

- [產線連鎖](automation-production-chain.md)
- [強化既有卡牌](deckbuilding-card-upgrade.md)
- [骰子配給](deckbuilding-dice-allocation.md)
- [起手牌的可控範圍](deckbuilding-opening-hand-control.md)

## 參考來源

- [Copying an invested card — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-duplicate-investment/) — 查閱：2026-11-02；取得方式：page-text。
