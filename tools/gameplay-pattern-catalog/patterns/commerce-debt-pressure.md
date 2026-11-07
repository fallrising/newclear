---
{
  "schema_version": 2,
  "id": "commerce-debt-pressure",
  "title": "債務壓力",
  "title_en": "Debt and cash-flow pressure",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "economy",
    "risk",
    "progression"
  ],
  "summary": "用持续偿债目标区分“赚到钱”和“真正能支配的钱”。",
  "note_status": "draft",
  "related": [
    "commerce-auction-bidding",
    "commerce-dynamic-market",
    "commerce-haggling",
    "commerce-price-discovery"
  ],
  "sources": [
    {
      "title": "Debt and cash-flow pressure — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-debt-pressure/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用持续偿债目标区分“赚到钱”和“真正能支配的钱”。」
出處：`sources/text/commerce-debt-pressure.json` 字元 181-206 `summary.zh`
顯示：用持續償債目標區分“賺到錢”和“真正能支配的錢”。

## 規則

「玩家经营或劳动取得收入，但必须先覆盖既有债务与持续费用。剩余资金可投资提高效率；过度投资可能让下一轮现金不足。」
出處：`sources/text/commerce-debt-pressure.json` 字元 332-387 `rules.zh`
顯示：玩家經營或勞動取得收入，但必須先覆蓋既有債務與持續費用。剩餘資金可投資提高效率；過度投資可能讓下一輪現金不足。

## 核心循環

「查看负债与费用」
出處：`sources/text/commerce-debt-pressure.json` 字元 611-618 `loop[0].zh`
顯示：查看負債與費用

「执行赚钱活动」
出處：`sources/text/commerce-debt-pressure.json` 字元 683-689 `loop[1].zh`
顯示：執行賺錢活動

「结算净收入」
出處：`sources/text/commerce-debt-pressure.json` 字元 745-750 `loop[2].zh`
顯示：結算淨收入

「选择还债或投资」
出處：`sources/text/commerce-debt-pressure.json` 字元 811-818 `loop[3].zh`
顯示：選擇還債或投資

## 玩家取捨

「把收入立即用于升级，还是留钱保障下次结算？」
出處：`sources/text/commerce-debt-pressure.json` 字元 898-919 `decisions[0].zh`
顯示：把收入立即用於升級，還是留錢保障下次結算？

「做安全的低收益工作，还是承担高风险争取提前脱身？」
出處：`sources/text/commerce-debt-pressure.json` 字元 1014-1038 `decisions[1].zh`
顯示：做安全的低收益工作，還是承擔高風險爭取提前脫身？

## 可調參數

「偿还节奏」
出處：`sources/text/commerce-debt-pressure.json` 字元 1175-1179 `parameters[0].name.zh`
顯示：償還節奏

「固定期限形成冲刺，持续扣费形成长期效率压力。」
出處：`sources/text/commerce-debt-pressure.json` 字元 1258-1280 `parameters[0].effect.zh`
顯示：固定期限形成衝刺，持續扣費形成長期效率壓力。

「破产后果」
出處：`sources/text/commerce-debt-pressure.json` 字元 1424-1428 `parameters[1].name.zh`
顯示：破產後果

「可恢复的失败鼓励试策略，重置进度容易放大重复劳动。」
出處：`sources/text/commerce-debt-pressure.json` 字元 1512-1537 `parameters[1].effect.zh`
顯示：可恢復的失敗鼓勵試策略，重置進度容易放大重複勞動。

## 原型

「做七天日历、一笔到期债务、两种工作和一项提高产能的投资。」
出處：`sources/text/commerce-debt-pressure.json` 字元 2991-3019 `prototype.firstStep.zh`
顯示：做七天日曆、一筆到期債務、兩種工作和一項提高產能的投資。

「观察玩家是否区分总收益与可立即支付的钱，并为到期日留现金。」
出處：`sources/text/commerce-debt-pressure.json` 字元 3323-3352 `prototype.test.zh`
顯示：觀察玩家是否區分總收益與可立即支付的錢，併爲到期日留現金。

「先让收入、支出和到期时间清晰可见；隐藏收费只会让计划失去依据。」
出處：`sources/text/commerce-debt-pressure.json` 字元 3163-3194 `prototype.pitfall.zh`
顯示：先讓收入、支出和到期時間清晰可見；隱藏收費只會讓計劃失去依據。

## 相關模式

- [拍賣出價](commerce-auction-bidding.md)
- [動態市場](commerce-dynamic-market.md)
- [議價中的讓步](commerce-haggling.md)
- [以回饋進行價格探索](commerce-price-discovery.md)

## 參考來源

- [Debt and cash-flow pressure — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-debt-pressure/) — 查閱：2026-11-02；取得方式：page-text。
