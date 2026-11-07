---
{
  "schema_version": 2,
  "id": "allocation-savings-interest",
  "title": "存款利息",
  "title_en": "Keep savings to earn next-round interest",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "economy",
    "risk"
  ],
  "summary": "少买一次强化，可能让以后每轮都多一笔收入。",
  "note_status": "draft",
  "related": [
    "incremental-farm-or-push",
    "commerce-auction-bidding",
    "commerce-debt-pressure",
    "commerce-dynamic-market"
  ],
  "sources": [
    {
      "title": "Keep savings to earn next-round interest — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-savings-interest/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「少买一次强化，可能让以后每轮都多一笔收入。」
出處：`sources/text/allocation-savings-interest.json` 字元 204-225 `summary.zh`
顯示：少買一次強化，可能讓以後每輪都多一筆收入。

## 規則

「每轮按结算时持有的资金计算额外收入，通常以整数门槛分档并设上限。玩家在即时强化与未来增长之间取舍；购买后是否跌破利息档位、当前战力能否撑住，决定存钱的代价。」
出處：`sources/text/allocation-savings-interest.json` 字元 326-404 `rules.zh`
顯示：每輪按結算時持有的資金計算額外收入，通常以整數門檻分檔並設上限。玩家在即時強化與未來增長之間取捨；購買後是否跌破利息檔位、當前戰力能否撐住，決定存錢的代價。

## 核心循環

「检查余额与下一档门槛」
出處：`sources/text/allocation-savings-interest.json` 字元 685-695 `loop[0].zh`
顯示：檢查餘額與下一檔門檻

「选择消费或保留资金」
出處：`sources/text/allocation-savings-interest.json` 字元 775-784 `loop[1].zh`
顯示：選擇消費或保留資金

「结算战果与利息」
出處：`sources/text/allocation-savings-interest.json` 字元 841-848 `loop[2].zh`
顯示：結算戰果與利息

「用新收入再次分配」
出處：`sources/text/allocation-savings-interest.json` 字元 922-930 `loop[3].zh`

## 玩家取捨

「为保住一档利息少买单位，可能多输一轮，能承受吗？」
出處：`sources/text/allocation-savings-interest.json` 字元 1018-1042 `decisions[0].zh`
顯示：爲保住一檔利息少買單位，可能多輸一輪，能承受嗎？

「接近出局时继续存钱，还是把积蓄一次花掉换即时强度？」
出處：`sources/text/allocation-savings-interest.json` 字元 1148-1173 `decisions[1].zh`
顯示：接近出局時繼續存錢，還是把積蓄一次花掉換即時強度？

## 可調參數

「利息档位」
出處：`sources/text/allocation-savings-interest.json` 字元 1330-1334 `parameters[0].name.zh`
顯示：利息檔位

「台阶式收入让接近门槛的每枚钱更有分量。」
出處：`sources/text/allocation-savings-interest.json` 字元 1415-1434 `parameters[0].effect.zh`
顯示：臺階式收入讓接近門檻的每枚錢更有分量。

「利息上限」
出處：`sources/text/allocation-savings-interest.json` 字元 1562-1566 `parameters[1].name.zh`

「上限提供开始消费的明确时点，也控制领先者滚雪球速度。」
出處：`sources/text/allocation-savings-interest.json` 字元 1640-1666 `parameters[1].effect.zh`
顯示：上限提供開始消費的明確時點，也控制領先者滾雪球速度。

## 原型

「做三轮数字战斗、两件强化和可见的利息预览，不需要英雄库。」
出處：`sources/text/allocation-savings-interest.json` 字元 3171-3199 `prototype.firstStep.zh`
顯示：做三輪數字戰鬥、兩件強化和可見的利息預覽，不需要英雄庫。

「玩家能否解释这次消费会少拿多少利息，以及为何仍值得？」
出處：`sources/text/allocation-savings-interest.json` 字元 3479-3505 `prototype.test.zh`
顯示：玩家能否解釋這次消費會少拿多少利息，以及爲何仍值得？

「结算时点不清会让玩家觉得系统吞钱；花费前就展示收入变化。」
出處：`sources/text/allocation-savings-interest.json` 字元 3328-3356 `prototype.pitfall.zh`
顯示：結算時點不清會讓玩家覺得系統吞錢；花費前就展示收入變化。

## 相關模式

- [經營推進](incremental-farm-or-push.md)
- [拍賣出價](commerce-auction-bidding.md)
- [債務壓力](commerce-debt-pressure.md)
- [動態市場](commerce-dynamic-market.md)

## 參考來源

- [Keep savings to earn next-round interest — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-savings-interest/) — 查閱：2026-11-02；取得方式：page-text。
