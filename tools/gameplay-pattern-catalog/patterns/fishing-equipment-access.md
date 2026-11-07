---
{
  "schema_version": 2,
  "id": "fishing-equipment-access",
  "title": "裝備進出",
  "title_en": "Equipment-gated catches",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "progression",
    "planning",
    "spatial"
  ],
  "summary": "新装备解锁新的可捕获范围，而不只是让旧任务变快。",
  "note_status": "draft",
  "related": [
    "fishing-cast-placement",
    "fishing-pond-production",
    "exploration-fast-travel-network",
    "fishing-bait-loadout"
  ],
  "sources": [
    {
      "title": "Equipment-gated catches — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-equipment-access/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「新装备解锁新的可捕获范围，而不只是让旧任务变快。」
出處：`sources/text/fishing-equipment-access.json` 字元 176-200 `summary.zh`
顯示：新裝備解鎖新的可捕獲範圍，而不只是讓舊任務變快。

## 規則

「玩家根据目标水域或鱼种准备兼容钓具，才能开始有效捕获。预算与携带空间限制全能配置；遭遇无法捕捞的地点会暴露下一项研究或采购目标。」
出處：`sources/text/fishing-equipment-access.json` 字元 324-388 `rules.zh`
顯示：玩家根據目標水域或魚種準備兼容釣具，才能開始有效捕獲。預算與攜帶空間限制全能配置；遭遇無法捕撈的地點會暴露下一項研究或採購目標。

## 核心循環

「发现尚不能捕获的目标」
出處：`sources/text/fishing-equipment-access.json` 字元 645-655 `loop[0].zh`
顯示：發現尚不能捕獲的目標

「识别所需钓具能力」
出處：`sources/text/fishing-equipment-access.json` 字元 729-737 `loop[1].zh`
顯示：識別所需釣具能力

「研究、购买并装配」
出處：`sources/text/fishing-equipment-access.json` 字元 813-821 `loop[2].zh`
顯示：研究、購買並裝配

「返回原地点验证解锁」
出處：`sources/text/fishing-equipment-access.json` 字元 888-897 `loop[3].zh`
顯示：返回原地點驗證解鎖

## 玩家取捨

「为一个稀有目标专门换装，还是携带覆盖广的组合，会改变出行目的。」
出處：`sources/text/fishing-equipment-access.json` 字元 991-1022 `decisions[0].zh`
顯示：爲一個稀有目標專門換裝，還是攜帶覆蓋廣的組合，會改變出行目的。

「现在花钱解锁一种新水域，还是先用现有装备赚钱，等能兼顾更多目标再升级？」
出處：`sources/text/fishing-equipment-access.json` 字元 1167-1202 `decisions[1].zh`
顯示：現在花錢解鎖一種新水域，還是先用現有裝備賺錢，等能兼顧更多目標再升級？

## 可調參數

「装备覆盖宽度」
出處：`sources/text/fishing-equipment-access.json` 字元 1386-1392 `parameters[0].name.zh`
顯示：裝備覆蓋寬度

「单一适配促使换装，多类兼容减少回城但容易形成唯一最优解。」
出處：`sources/text/fishing-equipment-access.json` 字元 1472-1500 `parameters[0].effect.zh`
顯示：單一適配促使換裝，多類兼容減少回城但容易形成唯一最優解。

「配置占地」
出處：`sources/text/fishing-equipment-access.json` 字元 1680-1684 `parameters[1].name.zh`
顯示：配置佔地

「装备越占空间，越必须在捕获范围与运货容量之间选择。」
出處：`sources/text/fishing-equipment-access.json` 字元 1763-1788 `parameters[1].effect.zh`
顯示：裝備越佔空間，越必須在捕獲範圍與運貨容量之間選擇。

## 原型

「用3类钓点和2个装备槽做资格匹配，清楚显示缺少哪种能力。」
出處：`sources/text/fishing-equipment-access.json` 字元 3321-3349 `prototype.firstStep.zh`
顯示：用3類釣點和2個裝備槽做資格匹配，清楚顯示缺少哪種能力。

「玩家看到新钓点后，能否自行规划换装，并说出牺牲了哪个原有功能？」
出處：`sources/text/fishing-equipment-access.json` 字元 3686-3717 `prototype.test.zh`
顯示：玩家看到新釣點後，能否自行規劃換裝，並說出犧牲了哪個原有功能？

「资格限制与捕获成功率要区分；不兼容时不应让玩家无意义地反复尝试。」
出處：`sources/text/fishing-equipment-access.json` 字元 3503-3535 `prototype.pitfall.zh`
顯示：資格限制與捕獲成功率要區分；不兼容時不應讓玩家無意義地反覆嘗試。

## 相關模式

- [拋投放置](fishing-cast-placement.md)
- [魚池產線](fishing-pond-production.md)
- [快速旅行網路](exploration-fast-travel-network.md)
- [餌配置組](fishing-bait-loadout.md)

## 參考來源

- [Equipment-gated catches — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-equipment-access/) — 查閱：2026-11-02；取得方式：page-text。
