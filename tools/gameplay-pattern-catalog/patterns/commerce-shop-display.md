---
{
  "schema_version": 2,
  "id": "commerce-shop-display",
  "title": "商店陳列",
  "title_en": "Shop display allocation",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "spatial",
    "economy",
    "planning"
  ],
  "summary": "让有限展示位成为销售策略，而不是把库存一股脑倒进商店。",
  "note_status": "draft",
  "related": [
    "allocation-shop-reservation",
    "commerce-regional-arbitrage",
    "commerce-timed-contracts",
    "commerce-trade-route-programming"
  ],
  "sources": [
    {
      "title": "Shop display allocation — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-shop-display/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让有限展示位成为销售策略，而不是把库存一股脑倒进商店。」
出處：`sources/text/commerce-shop-display.json` 字元 175-202 `summary.zh`
顯示：讓有限展示位成爲銷售策略，而不是把庫存一股腦倒進商店。

## 規則

「玩家选择上架哪些商品及展示位置，开店后观察销售与顾客反应。展示位和补货时间有限，未上架的库存不会自动获得同等销售机会。」
出處：`sources/text/commerce-shop-display.json` 字元 327-386 `rules.zh`
顯示：玩家選擇上架哪些商品及展示位置，開店後觀察銷售與顧客反應。展示位和補貨時間有限，未上架的庫存不會自動獲得同等銷售機會。

## 核心循環

「选择本轮商品」
出處：`sources/text/commerce-shop-display.json` 字元 601-607 `loop[0].zh`
顯示：選擇本輪商品

「安排展示位置」
出處：`sources/text/commerce-shop-display.json` 字元 672-678 `loop[1].zh`

「开店观察销售」
出處：`sources/text/commerce-shop-display.json` 字元 739-745 `loop[2].zh`
顯示：開店觀察銷售

「补货或更换陈列」
出處：`sources/text/commerce-shop-display.json` 字元 805-812 `loop[3].zh`
顯示：補貨或更換陳列

## 玩家取捨

「展示昂贵商品提高单笔收益，还是放便宜货加快周转？」
出處：`sources/text/commerce-shop-display.json` 字元 894-918 `decisions[0].zh`
顯示：展示昂貴商品提高單筆收益，還是放便宜貨加快週轉？

「保护稀有商品的位置，是否值得占用更好的展示资源？」
出處：`sources/text/commerce-shop-display.json` 字元 1027-1051 `decisions[1].zh`
顯示：保護稀有商品的位置，是否值得佔用更好的展示資源？

## 可調參數

「展示位数量」
出處：`sources/text/commerce-shop-display.json` 字元 1198-1203 `parameters[0].name.zh`
顯示：展示位數量

「少量位置强化选品，大量位置降低换货频率。」
出處：`sources/text/commerce-shop-display.json` 字元 1281-1301 `parameters[0].effect.zh`
顯示：少量位置強化選品，大量位置降低換貨頻率。

「位置差异」
出處：`sources/text/commerce-shop-display.json` 字元 1436-1440 `parameters[1].name.zh`
顯示：位置差異

「位置有功能差异才形成布局决策，否则只是装饰。」
出處：`sources/text/commerce-shop-display.json` 字元 1526-1548 `parameters[1].effect.zh`
顯示：位置有功能差異才形成佈局決策，否則只是裝飾。

## 原型

「做两格货架、四种商品和一队偏好不同的顾客，允许营业中补货。」
出處：`sources/text/commerce-shop-display.json` 字元 3030-3059 `prototype.firstStep.zh`
顯示：做兩格貨架、四種商品和一隊偏好不同的顧客，允許營業中補貨。

「限制一次补货机会，观察玩家是否依据销量改变陈列。」
出處：`sources/text/commerce-shop-display.json` 字元 3397-3421 `prototype.test.zh`
顯示：限制一次補貨機會，觀察玩家是否依據銷量改變陳列。

「先区别位置效果与价格效果，避免玩家不知道销量变化来自哪里。」
出處：`sources/text/commerce-shop-display.json` 字元 3232-3261 `prototype.pitfall.zh`
顯示：先區別位置效果與價格效果，避免玩家不知道銷量變化來自哪裏。

## 相關模式

- [商店保留與選項成本](allocation-shop-reservation.md)
- [區域價差](commerce-regional-arbitrage.md)
- [限時合約](commerce-timed-contracts.md)
- [貿易路線編排](commerce-trade-route-programming.md)

## 參考來源

- [Shop display allocation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-shop-display/) — 查閱：2026-11-02；取得方式：page-text。
