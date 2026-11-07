---
{
  "schema_version": 2,
  "id": "inventory-deck-thinning",
  "title": "牌組抽疏",
  "title_en": "Card removal and draw density",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "optimization",
    "planning",
    "randomness"
  ],
  "summary": "删掉弱卡，让想要的组合更常出现。",
  "note_status": "draft",
  "related": [
    "combat-combat-deck-cycle",
    "inventory-adjacency",
    "inventory-equipment-budget",
    "inventory-shape-packing"
  ],
  "sources": [
    {
      "title": "Card removal and draw density — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-deck-thinning/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「删掉弱卡，让想要的组合更常出现。」
出處：`sources/text/inventory-deck-thinning.json` 字元 186-202 `summary.zh`
顯示：刪掉弱卡，讓想要的組合更常出現。

## 規則

「玩家管理可反复抽取的牌库，删除卡牌通常需要支付资源或访问特定节点。减少无用牌会提高关键牌出现频率，但也可能损失应对不同局面的能力。」
出處：`sources/text/inventory-deck-thinning.json` 字元 305-370 `rules.zh`
顯示：玩家管理可反覆抽取的牌庫，刪除卡牌通常需要支付資源或訪問特定節點。減少無用牌會提高關鍵牌出現頻率，但也可能損失應對不同局面的能力。

## 核心循環

「识别低效卡牌」
出處：`sources/text/inventory-deck-thinning.json` 字元 624-630 `loop[0].zh`
顯示：識別低效卡牌

「获取删除机会」
出處：`sources/text/inventory-deck-thinning.json` 字元 698-704 `loop[1].zh`
顯示：獲取刪除機會

「权衡费用与覆盖面」
出處：`sources/text/inventory-deck-thinning.json` 字元 775-783 `loop[2].zh`
顯示：權衡費用與覆蓋面

「观察后续抽牌稳定性」
出處：`sources/text/inventory-deck-thinning.json` 字元 854-863 `loop[3].zh`
顯示：觀察後續抽牌穩定性

## 玩家取捨

「删掉最弱单卡，还是删掉与当前策略冲突的牌？」
出處：`sources/text/inventory-deck-thinning.json` 字元 958-979 `decisions[0].zh`
顯示：刪掉最弱單卡，還是刪掉與當前策略衝突的牌？

「极薄牌库更稳定，但面对干扰时是否过于脆弱？」
出處：`sources/text/inventory-deck-thinning.json` 字元 1091-1112 `decisions[1].zh`
顯示：極薄牌庫更穩定，但面對干擾時是否過於脆弱？

## 可調參數

「删除成本递增」
出處：`sources/text/inventory-deck-thinning.json` 字元 1259-1265 `parameters[0].name.zh`
顯示：刪除成本遞增

「递增费用限制快速压缩，迫使玩家排序。」
出處：`sources/text/inventory-deck-thinning.json` 字元 1350-1368 `parameters[0].effect.zh`
顯示：遞增費用限制快速壓縮，迫使玩家排序。

「初始牌库冗余」
出處：`sources/text/inventory-deck-thinning.json` 字元 1494-1500 `parameters[1].name.zh`
顯示：初始牌庫冗餘

「弱牌越多，前期删除越有价值；冗余少则更难取舍。」
出處：`sources/text/inventory-deck-thinning.json` 字元 1581-1604 `parameters[1].effect.zh`
顯示：弱牌越多，前期刪除越有價值；冗餘少則更難取捨。

## 原型

「做十张固定牌、可查看的抽牌记录，以及一次付费删除机会。」
出處：`sources/text/inventory-deck-thinning.json` 字元 3087-3114 `prototype.firstStep.zh`
顯示：做十張固定牌、可查看的抽牌記錄，以及一次付費刪除機會。

「让玩家解释为何删掉一张可用的牌，并检查关键组合是否更稳定出现。」
出處：`sources/text/inventory-deck-thinning.json` 字元 3423-3454 `prototype.test.zh`
顯示：讓玩家解釋爲何刪掉一張可用的牌，並檢查關鍵組合是否更穩定出現。

「需要让删牌前后可比较；只写概率说明而看不到实际抽牌变化很难理解。」
出處：`sources/text/inventory-deck-thinning.json` 字元 3250-3282 `prototype.pitfall.zh`
顯示：需要讓刪牌前後可比較；只寫概率說明而看不到實際抽牌變化很難理解。

## 相關模式

- [戰鬥牌組循環](combat-combat-deck-cycle.md)
- [相鄰關係驅動的組合加成](inventory-adjacency.md)
- [裝備預算](inventory-equipment-budget.md)
- [形狀式背包配置](inventory-shape-packing.md)

## 參考來源

- [Card removal and draw density — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-deck-thinning/) — 查閱：2026-11-02；取得方式：page-text。
