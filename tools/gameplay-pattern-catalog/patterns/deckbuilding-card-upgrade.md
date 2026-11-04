---
{
  "schema_version": 2,
  "id": "deckbuilding-card-upgrade",
  "title": "強化既有卡牌",
  "title_en": "Investing in existing cards",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "progression",
    "economy",
    "optimization"
  ],
  "summary": "不扩大牌库，而是挑一张值得反复使用的牌进行强化。",
  "note_status": "draft",
  "related": [
    "deckbuilding-duplicate-investment",
    "commerce-debt-pressure",
    "commerce-dynamic-market",
    "commerce-trade-route-programming"
  ],
  "sources": [
    {
      "title": "Investing in existing cards — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-card-upgrade/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不扩大牌库，而是挑一张值得反复使用的牌进行强化。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 189-213 `summary.zh`
顯示：不擴大牌庫，而是挑一張值得反覆使用的牌進行強化。

## 規則

「玩家花金币、休息机会或升级材料强化已有卡牌，增强数值或改变费用与效果。升级机会有限，因此需要判断哪张牌最常发挥作用；收益在之后每次抽到它时重复出现。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 319-393 `rules.zh`
顯示：玩家花金幣、休息機會或升級材料強化已有卡牌，增強數值或改變費用與效果。升級機會有限，因此需要判斷哪張牌最常發揮作用；收益在之後每次抽到它時重複出現。

## 核心循環

「找到经常使用的牌」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 611-619 `loop[0].zh`
顯示：找到經常使用的牌

「预览升级前后」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 690-696 `loop[1].zh`
顯示：預覽升級前後

「支付机会成本」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 758-764 `loop[2].zh`
顯示：支付機會成本

「重复享受强化收益」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 832-840 `loop[3].zh`
顯示：重複享受強化收益

## 玩家取捨

「升级主力输出，还是把一张昂贵牌降费以便整回合顺畅？」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 930-955 `decisions[0].zh`
顯示：升級主力輸出，還是把一張昂貴牌降費以便整回合順暢？

「现在升级，还是用同一次休息机会恢复生命？」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 1057-1077 `decisions[1].zh`
顯示：現在升級，還是用同一次休息機會恢復生命？

## 可調參數

「升级幅度」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 1211-1215 `parameters[0].name.zh`
顯示：升級幅度

「小幅数值提升适合稳定累积，改变费用更容易重塑组合。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 1291-1316 `parameters[0].effect.zh`
顯示：小幅數值提升適合穩定累積，改變費用更容易重塑組合。

「升级上限」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 1450-1454 `parameters[1].name.zh`
顯示：升級上限

「限制单牌强化次数，能促使投资分散到不同功能。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 1529-1551 `parameters[1].effect.zh`
顯示：限制單牌強化次數，能促使投資分散到不同功能。

## 原型

「做四张牌，每张只有一个明确升级；用两场战斗对比升级前后。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 2938-2966 `prototype.firstStep.zh`
顯示：做四張牌，每張只有一個明確升級；用兩場戰鬥對比升級前後。

「玩家能在升级前预测下一回合多做哪一步，升级后观察到它。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 3261-3288 `prototype.test.zh`
顯示：玩家能在升級前預測下一回合多做哪一步，升級後觀察到它。

「同时加入随机词缀和多层强化会让玩家看不出这次投资改变了什么。」
出處：`sources/text/deckbuilding-card-upgrade.json` 字元 3097-3127 `prototype.pitfall.zh`
顯示：同時加入隨機詞綴和多層強化會讓玩家看不出這次投資改變了什麼。

## 相關模式

- [複製投入](deckbuilding-duplicate-investment.md)
- [債務壓力](commerce-debt-pressure.md)
- [動態市場](commerce-dynamic-market.md)
- [貿易路線編排](commerce-trade-route-programming.md)

## 參考來源

- [Investing in existing cards — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-card-upgrade/) — 查閱：2026-11-02；取得方式：page-text。
