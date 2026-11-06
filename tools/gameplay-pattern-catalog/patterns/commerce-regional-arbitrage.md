---
{
  "schema_version": 2,
  "id": "commerce-regional-arbitrage",
  "title": "區域價差",
  "title_en": "Regional arbitrage",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "economy",
    "planning",
    "risk"
  ],
  "summary": "在地点之间搬运商品，赚取扣除路途成本后的差价。",
  "note_status": "draft",
  "related": [
    "allocation-shop-reservation",
    "commerce-auction-bidding",
    "commerce-debt-pressure",
    "commerce-dynamic-market"
  ],
  "sources": [
    {
      "title": "Regional arbitrage — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-regional-arbitrage/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「在地点之间搬运商品，赚取扣除路途成本后的差价。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 175-198 `summary.zh`
顯示：在地點之間搬運商品，賺取扣除路途成本後的差價。

## 規則

「玩家比较不同地点的进货价与卖价，选择货物和路线。运力、补给、危险和买方需求限制收益；回到港口的净利润才是真正结果。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 307-364 `rules.zh`
顯示：玩家比較不同地點的進貨價與賣價，選擇貨物和路線。運力、補給、危險和買方需求限制收益；回到港口的淨利潤纔是真正結果。

## 核心循環

「发现地区价差」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 608-614 `loop[0].zh`
顯示：發現地區價差

「采购并留足补给」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 680-687 `loop[1].zh`
顯示：採購並留足補給

「完成运输」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 753-757 `loop[2].zh`
顯示：完成運輸

「出售并核算净利」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 816-823 `loop[3].zh`
顯示：出售並覈算淨利

## 玩家取捨

「远处价差更大，是否覆盖多出的风险与补给？」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 917-937 `decisions[0].zh`
顯示：遠處價差更大，是否覆蓋多出的風險與補給？

「装满高价值货，还是留下应急空间？」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 1035-1051 `decisions[1].zh`
顯示：裝滿高價值貨，還是留下應急空間？

## 可調參數

「路途开销」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 1190-1194 `parameters[0].name.zh`
顯示：路途開銷

「持续补给成本会淘汰表面盈利却路途过长的路线。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 1271-1293 `parameters[0].effect.zh`
顯示：持續補給成本會淘汰表面盈利卻路途過長的路線。

「地区稀缺性」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 1439-1444 `parameters[1].name.zh`
顯示：地區稀缺性

「商品分布差异越大，探索新市场越有价值。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 1523-1542 `parameters[1].effect.zh`
顯示：商品分佈差異越大，探索新市場越有價值。

## 原型

「做三个地点、三种商品、固定运力与可见路费，用菜单完成运输。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 2973-3002 `prototype.firstStep.zh`
顯示：做三個地點、三種商品、固定運力與可見路費，用菜單完成運輸。

「加入一条价差大但路费高的路线，观察玩家是否会计算净收益。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 3339-3367 `prototype.test.zh`
顯示：加入一條價差大但路費高的路線，觀察玩家是否會計算淨收益。

「先验证贸易取舍；自由航海、战斗和动态经济会把一个小机制扩成大游戏。」
出處：`sources/text/commerce-regional-arbitrage.json` 字元 3159-3192 `prototype.pitfall.zh`
顯示：先驗證貿易取捨；自由航海、戰鬥和動態經濟會把一個小機制擴成大遊戲。

## 相關模式

- [商店保留與選項成本](allocation-shop-reservation.md)
- [拍賣出價](commerce-auction-bidding.md)
- [債務壓力](commerce-debt-pressure.md)
- [動態市場](commerce-dynamic-market.md)

## 參考來源

- [Regional arbitrage — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-regional-arbitrage/) — 查閱：2026-11-02；取得方式：page-text。
