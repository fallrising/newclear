---
{
  "schema_version": 2,
  "id": "commerce-auction-bidding",
  "title": "拍賣出價",
  "title_en": "Auction bidding limits",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "economy",
    "information",
    "risk"
  ],
  "summary": "在对手不断抬价时，守住自己对标的的真实估值。",
  "note_status": "draft",
  "related": [
    "commerce-price-discovery",
    "commerce-debt-pressure",
    "commerce-dynamic-market",
    "commerce-haggling"
  ],
  "sources": [
    {
      "title": "Auction bidding limits — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-auction-bidding/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「在对手不断抬价时，守住自己对标的的真实估值。」
出處：`sources/text/commerce-auction-bidding.json` 字元 177-199 `summary.zh`
顯示：在對手不斷擡價時，守住自己對標的的真實估值。

## 規則

「玩家观察拍品与当前报价，选择加价或退出。获胜不等于盈利：支付成本必须与转售价值或战略用途比较；别人退出后才真正结算。」
出處：`sources/text/commerce-auction-bidding.json` 字元 294-352 `rules.zh`
顯示：玩家觀察拍品與當前報價，選擇加價或退出。獲勝不等於盈利：支付成本必須與轉售價值或戰略用途比較；別人退出後才真正結算。

## 核心循環

「估计拍品价值」
出處：`sources/text/commerce-auction-bidding.json` 字元 571-577 `loop[0].zh`
顯示：估計拍品價值

「设定最高出价」
出處：`sources/text/commerce-auction-bidding.json` 字元 634-640 `loop[1].zh`
顯示：設定最高出價

「跟价或退出」
出處：`sources/text/commerce-auction-bidding.json` 字元 697-702 `loop[2].zh`
顯示：跟價或退出

「兑现用途或转售」
出處：`sources/text/commerce-auction-bidding.json` 字元 761-768 `loop[3].zh`
顯示：兌現用途或轉售

## 玩家取捨

「拍品对自己价值普通，但能否阻止对手形成优势？」
出處：`sources/text/commerce-auction-bidding.json` 字元 846-868 `decisions[0].zh`
顯示：拍品對自己價值普通，但能否阻止對手形成優勢？

「已经投入的竞价时间，是否正在诱导自己越过止损线？」
出處：`sources/text/commerce-auction-bidding.json` 字元 969-993 `decisions[1].zh`
顯示：已經投入的競價時間，是否正在誘導自己越過止損線？

## 可調參數

「价值不确定性」
出處：`sources/text/commerce-auction-bidding.json` 字元 1133-1139 `parameters[0].name.zh`
顯示：價值不確定性

「信息不全会放大捡漏与买贵的风险。」
出處：`sources/text/commerce-auction-bidding.json` 字元 1222-1238 `parameters[0].effect.zh`
顯示：信息不全會放大撿漏與買貴的風險。

「加价步长」
出處：`sources/text/commerce-auction-bidding.json` 字元 1373-1377 `parameters[1].name.zh`
顯示：加價步長

「大步长缩短竞拍，但减少细致试探空间。」
出處：`sources/text/commerce-auction-bidding.json` 字元 1453-1471 `parameters[1].effect.zh`
顯示：大步長縮短競拍，但減少細緻試探空間。

## 原型

「做三个有参考估值的拍品和两个不同出价上限的电脑对手。」
出處：`sources/text/commerce-auction-bidding.json` 字元 2855-2881 `prototype.firstStep.zh`
顯示：做三個有參考估值的拍品和兩個不同出價上限的電腦對手。

「观察玩家是否会放弃已经追价多轮的拍品，而非把获胜本身当作盈利。」
出處：`sources/text/commerce-auction-bidding.json` 字元 3189-3220 `prototype.test.zh`
顯示：觀察玩家是否會放棄已經追價多輪的拍品，而非把獲勝本身當作盈利。

「先区分估值线索与真实价值；对手全知会让玩家觉得竞争不公平。」
出處：`sources/text/commerce-auction-bidding.json` 字元 3024-3053 `prototype.pitfall.zh`
顯示：先區分估值線索與真實價值；對手全知會讓玩家覺得競爭不公平。

## 相關模式

- [以回饋進行價格探索](commerce-price-discovery.md)
- [債務壓力](commerce-debt-pressure.md)
- [動態市場](commerce-dynamic-market.md)
- [議價中的讓步](commerce-haggling.md)

## 參考來源

- [Auction bidding limits — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-auction-bidding/) — 查閱：2026-11-02；取得方式：page-text。
