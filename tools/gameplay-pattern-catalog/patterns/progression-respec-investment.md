---
{
  "schema_version": 2,
  "id": "progression-respec-investment",
  "title": "重配投入",
  "title_en": "Refund and reassign upgrades",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "planning",
    "economy",
    "progression"
  ],
  "summary": "保留已有成长，付出代价后换一种能力组合。",
  "note_status": "draft",
  "related": [
    "progression-research-prerequisites",
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-evolution-recipes"
  ],
  "sources": [
    {
      "title": "Refund and reassign upgrades — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-respec-investment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「保留已有成长，付出代价后换一种能力组合。」
出處：`sources/text/progression-respec-investment.json` 字元 191-211 `summary.zh`
顯示：保留已有成長，付出代價後換一種能力組合。

## 規則

「玩家可以退回已经投入的技能点，再按规则分配到其他能力。重分配可能收费、限定地点或限制可改内容，让失败的方案能修正，同时保留更换路线的取舍。」
出處：`sources/text/progression-respec-investment.json` 字元 310-379 `rules.zh`
顯示：玩家可以退回已經投入的技能點，再按規則分配到其他能力。重分配可能收費、限定地點或限制可改內容，讓失敗的方案能修正，同時保留更換路線的取捨。

## 核心循環

「发现当前能力不合需求」
出處：`sources/text/progression-respec-investment.json` 字元 616-626 `loop[0].zh`
顯示：發現當前能力不合需求

「查看能退回的投入和代价」
出處：`sources/text/progression-respec-investment.json` 字元 689-700 `loop[1].zh`
顯示：查看能退回的投入和代價

「重新分配」
出處：`sources/text/progression-respec-investment.json` 字元 766-770 `loop[2].zh`

「用同一挑战比较效果」
出處：`sources/text/progression-respec-investment.json` 字元 822-831 `loop[3].zh`
顯示：用同一挑戰比較效果

## 玩家取捨

「花钱立即换路线，还是继续用现有方案攒资源？」
出處：`sources/text/progression-respec-investment.json` 字元 925-946 `decisions[0].zh`
顯示：花錢立即換路線，還是繼續用現有方案攢資源？

「只改一个短板，还是重做整套能力？改动越多，越需要重新适应。」
出處：`sources/text/progression-respec-investment.json` 字元 1049-1078 `decisions[1].zh`
顯示：只改一個短板，還是重做整套能力？改動越多，越需要重新適應。

## 可調參數

「退点成本」
出處：`sources/text/progression-respec-investment.json` 字元 1232-1236 `parameters[0].name.zh`
顯示：退點成本

「成本太高会让玩家不敢实验；完全免费则更容易每场都换最优解。」
出處：`sources/text/progression-respec-investment.json` 字元 1309-1338 `parameters[0].effect.zh`
顯示：成本太高會讓玩家不敢實驗；完全免費則更容易每場都換最優解。

「允许修改的范围」
出處：`sources/text/progression-respec-investment.json` 字元 1501-1508 `parameters[1].name.zh`
顯示：允許修改的範圍

「能改技能但不能改身份，会保留一部分长期承诺。」
出處：`sources/text/progression-respec-investment.json` 字元 1586-1608 `parameters[1].effect.zh`
顯示：能改技能但不能改身份，會保留一部分長期承諾。

## 原型

「做两条各三级的能力、固定敌人和可撤回的点数界面，先显示费用再确认。」
出處：`sources/text/progression-respec-investment.json` 字元 3081-3114 `prototype.firstStep.zh`
顯示：做兩條各三級的能力、固定敵人和可撤回的點數界面，先顯示費用再確認。

「一次失败后，玩家能否自己找到可修正的点，并准确预判退款和新能力？」
出處：`sources/text/progression-respec-investment.json` 字元 3422-3454 `prototype.test.zh`
顯示：一次失敗後，玩家能否自己找到可修正的點，並準確預判退款和新能力？

「别先支持所有身份重建；先把点数返还和能力依赖处理清楚。」
出處：`sources/text/progression-respec-investment.json` 字元 3257-3284 `prototype.pitfall.zh`
顯示：別先支持所有身份重建；先把點數返還和能力依賴處理清楚。

## 相關模式

- [研究前置](progression-research-prerequisites.md)
- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [進化配方鏈](progression-evolution-recipes.md)

## 參考來源

- [Refund and reassign upgrades — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-respec-investment/) — 查閱：2026-11-02；取得方式：page-text。
