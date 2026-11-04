---
{
  "schema_version": 2,
  "id": "commerce-dynamic-market",
  "title": "動態市場",
  "title_en": "Supply-driven market prices",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "economy",
    "optimization",
    "risk"
  ],
  "summary": "让买卖行为改变下一次报价，市场成为会被玩家影响的系统。",
  "note_status": "draft",
  "related": [
    "commerce-auction-bidding",
    "commerce-debt-pressure",
    "commerce-haggling",
    "commerce-price-discovery"
  ],
  "sources": [
    {
      "title": "Supply-driven market prices — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-dynamic-market/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让买卖行为改变下一次报价，市场成为会被玩家影响的系统。」
出處：`sources/text/commerce-dynamic-market.json` 字元 180-207 `summary.zh`
顯示：讓買賣行爲改變下一次報價，市場成爲會被玩家影響的系統。

## 規則

「玩家观察行情后买入或卖出。市场供需随交易与生产变化，连续抛售可能压低自身利润；收入反馈同时也是下一步的市场信号。」
出處：`sources/text/commerce-dynamic-market.json` 字元 330-386 `rules.zh`
顯示：玩家觀察行情後買入或賣出。市場供需隨交易與生產變化，連續拋售可能壓低自身利潤；收入反饋同時也是下一步的市場信號。

## 核心循環

「观察价格与产量」
出處：`sources/text/commerce-dynamic-market.json` 字元 617-624 `loop[0].zh`
顯示：觀察價格與產量

「选择买卖方向」
出處：`sources/text/commerce-dynamic-market.json` 字元 693-699 `loop[1].zh`
顯示：選擇買賣方向

「执行交易」
出處：`sources/text/commerce-dynamic-market.json` 字元 757-761 `loop[2].zh`
顯示：執行交易

「重估改变后的市场」
出處：`sources/text/commerce-dynamic-market.json` 字元 815-823 `loop[3].zh`
顯示：重估改變後的市場

## 玩家取捨

「现在卖掉锁定收益，还是等待需求上升？」
出處：`sources/text/commerce-dynamic-market.json` 字元 915-933 `decisions[0].zh`
顯示：現在賣掉鎖定收益，還是等待需求上升？

「扩大产能是否会把高价市场自己做没？」
出處：`sources/text/commerce-dynamic-market.json` 字元 1017-1034 `decisions[1].zh`
顯示：擴大產能是否會把高價市場自己做沒？

## 可調參數

「价格弹性」
出處：`sources/text/commerce-dynamic-market.json` 字元 1171-1175 `parameters[0].name.zh`
顯示：價格彈性

「交易少量就大幅变价会强化择时，也可能鼓励短线操控。」
出處：`sources/text/commerce-dynamic-market.json` 字元 1253-1278 `parameters[0].effect.zh`
顯示：交易少量就大幅變價會強化擇時，也可能鼓勵短線操控。

「市场共享范围」
出處：`sources/text/commerce-dynamic-market.json` 字元 1416-1422 `parameters[1].name.zh`
顯示：市場共享範圍

「共享市场加强对抗，分区市场增加运输意义。」
出處：`sources/text/commerce-dynamic-market.json` 字元 1496-1516 `parameters[1].effect.zh`
顯示：共享市場加強對抗，分區市場增加運輸意義。

## 原型

「做两种商品、可见库存与简单的供需价格公式，每轮刷新需求。」
出處：`sources/text/commerce-dynamic-market.json` 字元 2982-3010 `prototype.firstStep.zh`
顯示：做兩種商品、可見庫存與簡單的供需價格公式，每輪刷新需求。

「大批卖出后，玩家是否理解自己压低了价格，并改变后续交易量。」
出處：`sources/text/commerce-dynamic-market.json` 字元 3318-3347 `prototype.test.zh`
顯示：大批賣出後，玩家是否理解自己壓低了價格，並改變後續交易量。

「先限制价格边界和买卖差价，避免玩家靠同一循环无限套利。」
出處：`sources/text/commerce-dynamic-market.json` 字元 3163-3190 `prototype.pitfall.zh`
顯示：先限制價格邊界和買賣差價，避免玩家靠同一循環無限套利。

## 相關模式

- [拍賣出價](commerce-auction-bidding.md)
- [債務壓力](commerce-debt-pressure.md)
- [議價中的讓步](commerce-haggling.md)
- [以回饋進行價格探索](commerce-price-discovery.md)

## 參考來源

- [Supply-driven market prices — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-dynamic-market/) — 查閱：2026-11-02；取得方式：page-text。
