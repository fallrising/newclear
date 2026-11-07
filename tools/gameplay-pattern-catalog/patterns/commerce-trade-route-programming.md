---
{
  "schema_version": 2,
  "id": "commerce-trade-route-programming",
  "title": "貿易路線編排",
  "title_en": "Programmed trade routes",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "planning",
    "optimization",
    "economy"
  ],
  "summary": "把反复跑商变成可调的路线与装卸规则，管理例外而非每次下令。",
  "note_status": "draft",
  "related": [
    "allocation-shop-reservation",
    "commerce-dynamic-market",
    "commerce-regional-arbitrage",
    "commerce-shop-display"
  ],
  "sources": [
    {
      "title": "Programmed trade routes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-trade-route-programming/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把反复跑商变成可调的路线与装卸规则，管理例外而非每次下令。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 185-214 `summary.zh`
顯示：把反覆跑商變成可調的路線與裝卸規則，管理例外而非每次下令。

## 規則

「玩家选择停靠点、货物和运输船，配置每站装卸或交易条件。船只循环执行，短缺、拥堵或风险暴露后再修改路线；自动化仍需监督。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 354-413 `rules.zh`
顯示：玩家選擇停靠點、貨物和運輸船，配置每站裝卸或交易條件。船隻循環執行，短缺、擁堵或風險暴露後再修改路線；自動化仍需監督。

## 核心循環

「确定供需地点」
出處：`sources/text/commerce-trade-route-programming.json` 字元 656-662 `loop[0].zh`
顯示：確定供需地點

「配置停靠与货物」
出處：`sources/text/commerce-trade-route-programming.json` 字元 733-740 `loop[1].zh`
顯示：配置停靠與貨物

「运行一轮航线」
出處：`sources/text/commerce-trade-route-programming.json` 字元 809-815 `loop[2].zh`
顯示：運行一輪航線

「检查瓶颈并调整」
出處：`sources/text/commerce-trade-route-programming.json` 字元 872-879 `loop[3].zh`
顯示：檢查瓶頸並調整

## 玩家取捨

「一条长环线充分利用运力，还是多条短线提高稳定性？」
出處：`sources/text/commerce-trade-route-programming.json` 字元 962-986 `decisions[0].zh`
顯示：一條長環線充分利用運力，還是多條短線提高穩定性？

「运力不够时增加船只，还是调整装卸与停靠顺序？」
出處：`sources/text/commerce-trade-route-programming.json` 字元 1106-1128 `decisions[1].zh`
顯示：運力不夠時增加船隻，還是調整裝卸與停靠順序？

## 可調參數

「规则精度」
出處：`sources/text/commerce-trade-route-programming.json` 字元 1257-1261 `parameters[0].name.zh`
顯示：規則精度

「可设数量和价格更灵活，但配置负担更大。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 1339-1358 `parameters[0].effect.zh`
顯示：可設數量和價格更靈活，但配置負擔更大。

「运输可预测性」
出處：`sources/text/commerce-trade-route-programming.json` 字元 1486-1492 `parameters[1].name.zh`
顯示：運輸可預測性

「稳定航程适合算产量，天气海盗会增加缓冲需求。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 1575-1597 `parameters[1].effect.zh`
顯示：穩定航程適合算產量，天氣海盜會增加緩衝需求。

## 原型

「做三个港口、一艘船和装、卸、等待三个命令，用时间步模拟执行。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 3091-3121 `prototype.firstStep.zh`
顯示：做三個港口、一艘船和裝、卸、等待三個命令，用時間步模擬執行。

「故意制造一处积压，观察玩家是否通过库存与航程记录找到原因并修改路线。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 3439-3473 `prototype.test.zh`
顯示：故意製造一處積壓，觀察玩家是否通過庫存與航程記錄找到原因並修改路線。

「先处理缺货、满仓和目的地不收货的例外，再加入更多船与复杂航线。」
出處：`sources/text/commerce-trade-route-programming.json` 字元 3267-3298 `prototype.pitfall.zh`
顯示：先處理缺貨、滿倉和目的地不收貨的例外，再加入更多船與複雜航線。

## 相關模式

- [商店保留與選項成本](allocation-shop-reservation.md)
- [動態市場](commerce-dynamic-market.md)
- [區域價差](commerce-regional-arbitrage.md)
- [商店陳列](commerce-shop-display.md)

## 參考來源

- [Programmed trade routes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-trade-route-programming/) — 查閱：2026-11-02；取得方式：page-text。
