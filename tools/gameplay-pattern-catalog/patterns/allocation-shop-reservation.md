---
{
  "schema_version": 2,
  "id": "allocation-shop-reservation",
  "title": "商店保留與選項成本",
  "title_en": "Reserve a shop item for a later purchase",
  "category": "allocation",
  "source_category": "commerce",
  "tags": [
    "option-value",
    "opportunity-cost",
    "future-planning"
  ],
  "summary": "暂时买不起，也可以先保住这次机会。",
  "note_status": "draft",
  "related": [
    "inventory-shape-packing",
    "commerce-price-discovery"
  ],
  "sources": [
    {
      "title": "Reserve a shop item for a later purchase — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-shop-reservation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「暂时买不起，也可以先保住这次机会。」
出處：`sources/text/allocation-shop-reservation.json` 字元 201-218 `summary.zh`
顯示：暫時買不起，也可以先保住這次機會。

## 規則

「玩家标记商店中的某个物品，使它在刷新或下一轮补货时保留，未保留的格子继续更新。保留能等待资金或组合条件，却占掉发现新商品的位置；解除保留会重新开放这个位置。」
出處：`sources/text/allocation-shop-reservation.json` 字元 318-396 `rules.zh`
顯示：玩家標記商店中的某個物品，使它在刷新或下一輪補貨時保留，未保留的格子繼續更新。保留能等待資金或組合條件，卻佔掉發現新商品的位置；解除保留會重新開放這個位置。

## 核心循環

「找到暂时无法购买的目标」
出處：`sources/text/allocation-shop-reservation.json` 字元 665-676 `loop[0].zh`
顯示：找到暫時無法購買的目標

「标记保留并刷新其他格」
出處：`sources/text/allocation-shop-reservation.json` 字元 752-762 `loop[1].zh`
顯示：標記保留並刷新其他格

「获得资金或改变需求」
出處：`sources/text/allocation-shop-reservation.json` 字元 840-849 `loop[2].zh`
顯示：獲得資金或改變需求

「购买目标或解除保留」
出處：`sources/text/allocation-shop-reservation.json` 字元 928-937 `loop[3].zh`
顯示：購買目標或解除保留

## 玩家取捨

「为未来组合保留一件，会不会错过本轮更实用的新货？」
出處：`sources/text/allocation-shop-reservation.json` 字元 1028-1052 `decisions[0].zh`
顯示：爲未來組合保留一件，會不會錯過本輪更實用的新貨？

「资金够了，但需求已经变化，是否承认沉没成本并放弃？」
出處：`sources/text/allocation-shop-reservation.json` 字元 1166-1191 `decisions[1].zh`
顯示：資金夠了，但需求已經變化，是否承認沉沒成本並放棄？

## 可調參數

「可保留格数」
出處：`sources/text/allocation-shop-reservation.json` 字元 1347-1352 `parameters[0].name.zh`
顯示：可保留格數

「格数多降低错失焦虑，格数少让信息空间成为真实成本。」
出處：`sources/text/allocation-shop-reservation.json` 字元 1434-1459 `parameters[0].effect.zh`
顯示：格數多降低錯失焦慮，格數少讓信息空間成爲真實成本。

「保留持续范围」
出處：`sources/text/allocation-shop-reservation.json` 字元 1608-1614 `parameters[1].name.zh`
顯示：保留持續範圍

「只跨一次刷新适合轻决策，跨回合保留鼓励更长计划。」
出處：`sources/text/allocation-shop-reservation.json` 字元 1687-1711 `parameters[1].effect.zh`
顯示：只跨一次刷新適合輕決策，跨回合保留鼓勵更長計劃。

## 原型

「四格商店、刷新按钮、金币和保留标记，先做两轮即可。」
出處：`sources/text/allocation-shop-reservation.json` 字元 3174-3199 `prototype.firstStep.zh`
顯示：四格商店、刷新按鈕、金幣和保留標記，先做兩輪即可。

「玩家是否会主动解除不再需要的保留，而非永远占着格子？」
出處：`sources/text/allocation-shop-reservation.json` 字元 3466-3492 `prototype.test.zh`
顯示：玩家是否會主動解除不再需要的保留，而非永遠佔着格子？

「保留和购买必须有明确区分，避免误以为已经拥有物品。」
出處：`sources/text/allocation-shop-reservation.json` 字元 3341-3366 `prototype.pitfall.zh`
顯示：保留和購買必須有明確區分，避免誤以爲已經擁有物品。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)
- [以回饋進行價格探索](commerce-price-discovery.md)

## 參考來源

- [Reserve a shop item for a later purchase — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-shop-reservation/) — 查閱：2026-11-02；取得方式：page-text。
