---
{
  "schema_version": 2,
  "id": "allocation-shared-stock",
  "title": "共享人才池的招募",
  "title_en": "Recruit from a shared stock",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "information",
    "economy"
  ],
  "summary": "别人买走的同类单位，会减少你继续补齐的机会。",
  "note_status": "draft",
  "related": [
    "allocation-follow-phase",
    "allocation-public-pick",
    "allocation-worker-placement",
    "allocation-area-majority"
  ],
  "sources": [
    {
      "title": "Recruit from a shared stock — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-shared-stock/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「别人买走的同类单位，会减少你继续补齐的机会。」
出處：`sources/text/allocation-shared-stock.json` 字元 185-207 `summary.zh`
顯示：別人買走的同類單位，會減少你繼續補齊的機會。

## 規則

「每种单位的可用副本来自所有玩家共用的有限库存，商店从剩余库存抽取。玩家观察他人持有量来判断是否继续追同一种单位，或改选竞争较少的方向；出售等规则可能让副本回流。」
出處：`sources/text/allocation-shared-stock.json` 字元 312-392 `rules.zh`
顯示：每種單位的可用副本來自所有玩家共用的有限庫存，商店從剩餘庫存抽取。玩家觀察他人持有量來判斷是否繼續追同一種單位，或改選競爭較少的方向；出售等規則可能讓副本回流。

## 核心循環

「查看自己与他人的持有量」
出處：`sources/text/allocation-shared-stock.json` 字元 679-690 `loop[0].zh`
顯示：查看自己與他人的持有量

「购买或放弃竞争中的单位」
出處：`sources/text/allocation-shared-stock.json` 字元 774-785 `loop[1].zh`
顯示：購買或放棄競爭中的單位

「共享余量改变后续出现机会」
出處：`sources/text/allocation-shared-stock.json` 字元 860-872 `loop[2].zh`
顯示：共享餘量改變後續出現機會

「转向较少人使用的选择」
出處：`sources/text/allocation-shared-stock.json` 字元 961-971 `loop[3].zh`
顯示：轉向較少人使用的選擇

## 玩家取捨

「已经投入很多，却发现多人也在买同一种单位，还要继续刷新吗？」
出處：`sources/text/allocation-shared-stock.json` 字元 1071-1100 `decisions[0].zh`
顯示：已經投入很多，卻發現多人也在買同一種單位，還要繼續刷新嗎？

「买下对手急需的单位会占用资金与格子，阻断收益是否够大？」
出處：`sources/text/allocation-shared-stock.json` 字元 1223-1250 `decisions[1].zh`
顯示：買下對手急需的單位會佔用資金與格子，阻斷收益是否夠大？

## 可調參數

「每类副本数」
出處：`sources/text/allocation-shared-stock.json` 字元 1395-1400 `parameters[0].name.zh`
顯示：每類副本數

「数量越少，观察他人阵容越重要，也更容易被迫改方向。」
出處：`sources/text/allocation-shared-stock.json` 字元 1477-1502 `parameters[0].effect.zh`
顯示：數量越少，觀察他人陣容越重要，也更容易被迫改方向。

「回流规则」
出處：`sources/text/allocation-shared-stock.json` 字元 1639-1643 `parameters[1].name.zh`
顯示：迴流規則

「出售或淘汰后的回流会让紧缺单位重新出现，形成等待窗口。」
出處：`sources/text/allocation-shared-stock.json` 字元 1717-1744 `parameters[1].effect.zh`
顯示：出售或淘汰後的迴流會讓緊缺單位重新出現，形成等待窗口。

## 原型

「两名本地玩家共用三类单位库存，让每次购买立即更新公共余量。」
出處：`sources/text/allocation-shared-stock.json` 字元 3234-3263 `prototype.firstStep.zh`
顯示：兩名本地玩家共用三類單位庫存，讓每次購買立即更新公共餘量。

「玩家是否因对手持有量改变刷新或转型决定？」
出處：`sources/text/allocation-shared-stock.json` 字元 3555-3575 `prototype.test.zh`
顯示：玩家是否因對手持有量改變刷新或轉型決定？

「只告诉玩家概率下降却不解释共享来源，会把对抗误读成纯运气。」
出處：`sources/text/allocation-shared-stock.json` 字元 3402-3431 `prototype.pitfall.zh`
顯示：只告訴玩家概率下降卻不解釋共享來源，會把對抗誤讀成純運氣。

## 相關模式

- [跟進階段](allocation-follow-phase.md)
- [公開選取](allocation-public-pick.md)
- [工人放置](allocation-worker-placement.md)
- [區域多數](allocation-area-majority.md)

## 參考來源

- [Recruit from a shared stock — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-shared-stock/) — 查閱：2026-11-02；取得方式：page-text。
