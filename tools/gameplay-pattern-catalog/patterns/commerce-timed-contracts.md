---
{
  "schema_version": 2,
  "id": "commerce-timed-contracts",
  "title": "限時合約",
  "title_en": "Timed delivery contracts",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "planning",
    "time",
    "economy"
  ],
  "summary": "在接单之前判断能力，把生产计划与交付承诺绑定。",
  "note_status": "draft",
  "related": [
    "allocation-shop-reservation",
    "commerce-regional-arbitrage",
    "commerce-shop-display",
    "commerce-trade-route-programming"
  ],
  "sources": [
    {
      "title": "Timed delivery contracts — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-timed-contracts/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「在接单之前判断能力，把生产计划与交付承诺绑定。」
出處：`sources/text/commerce-timed-contracts.json` 字元 178-201 `summary.zh`
顯示：在接單之前判斷能力，把生產計劃與交付承諾綁定。

## 規則

「玩家从委托中选择一项，确认数量、质量或收集条件及期限。完成制作和交付领取报酬；接得太满可能让材料、设备或日程互相冲突。」
出處：`sources/text/commerce-timed-contracts.json` 字元 322-381 `rules.zh`
顯示：玩家從委託中選擇一項，確認數量、質量或收集條件及期限。完成製作和交付領取報酬；接得太滿可能讓材料、設備或日程互相沖突。

## 核心循環

「比较报酬与要求」
出處：`sources/text/commerce-timed-contracts.json` 字元 616-623 `loop[0].zh`
顯示：比較報酬與要求

「确认产能后接单」
出處：`sources/text/commerce-timed-contracts.json` 字元 693-700 `loop[1].zh`
顯示：確認產能後接單

「安排生产采集」
出處：`sources/text/commerce-timed-contracts.json` 字元 766-772 `loop[2].zh`
顯示：安排生產採集

「期限内交付」
出處：`sources/text/commerce-timed-contracts.json` 字元 835-840 `loop[3].zh`
顯示：期限內交付

## 玩家取捨

「高报酬难单和低风险小单，哪个更适合当前产能？」
出處：`sources/text/commerce-timed-contracts.json` 字元 932-954 `decisions[0].zh`
顯示：高報酬難單和低風險小單，哪個更適合當前產能？

「为赶单买材料，会不会让利润消失？」
出處：`sources/text/commerce-timed-contracts.json` 字元 1047-1063 `decisions[1].zh`
顯示：爲趕單買材料，會不會讓利潤消失？

## 可調參數

「期限宽裕度」
出處：`sources/text/commerce-timed-contracts.json` 字元 1194-1199 `parameters[0].name.zh`
顯示：期限寬裕度

「短期限强调排程，长期限强调跨日资源配置。」
出處：`sources/text/commerce-timed-contracts.json` 字元 1275-1295 `parameters[0].effect.zh`
顯示：短期限強調排程，長期限強調跨日資源配置。

「违约代价」
出處：`sources/text/commerce-timed-contracts.json` 字元 1445-1449 `parameters[1].name.zh`
顯示：違約代價

「只损失机会鼓励尝试，扣信誉则要求更谨慎接单。」
出處：`sources/text/commerce-timed-contracts.json` 字元 1523-1545 `parameters[1].effect.zh`
顯示：只損失機會鼓勵嘗試，扣信譽則要求更謹慎接單。

## 原型

「做两台设备、三张不同期限订单和可查看的每日生产表。」
出處：`sources/text/commerce-timed-contracts.json` 字元 3070-3095 `prototype.firstStep.zh`
顯示：做兩臺設備、三張不同期限訂單和可查看的每日生產表。

「提供一张报酬高但做不完的订单，观察玩家是否主动拒绝。」
出處：`sources/text/commerce-timed-contracts.json` 字元 3386-3412 `prototype.test.zh`
顯示：提供一張報酬高但做不完的訂單，觀察玩家是否主動拒絕。

「别靠突然改变期限制造难度；让玩家接单前就能看到主要约束。」
出處：`sources/text/commerce-timed-contracts.json` 字元 3227-3255 `prototype.pitfall.zh`
顯示：別靠突然改變期限制造難度；讓玩家接單前就能看到主要約束。

## 相關模式

- [商店保留與選項成本](allocation-shop-reservation.md)
- [區域價差](commerce-regional-arbitrage.md)
- [商店陳列](commerce-shop-display.md)
- [貿易路線編排](commerce-trade-route-programming.md)

## 參考來源

- [Timed delivery contracts — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-timed-contracts/) — 查閱：2026-11-02；取得方式：page-text。
